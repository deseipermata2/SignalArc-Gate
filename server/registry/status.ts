import {
  encodeAbiParameters,
  toHex,
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Hex,
} from 'viem'
import { httpsUpstream } from '../../shared/resources'
import { requireSession } from '../sg03/auth'
import { HttpError, json, type ApiConfig } from '../sg03/http'

export const deployment = Object.freeze({
  chainId: 8453,
  address: '0xC4081a85935de1b9a929e5a6835d99471cd08c01',
  runtimeCodeHash:
    '0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df',
  deploymentEvidence: 'owner_verified',
  explorerVerification: 'unverified',
  paymentsEnabled: false,
})
export const abi = parseAbi([
  'function CHAIN_ID() view returns (uint256)',
  'function getResource(bytes32 resourceId) view returns ((address owner,uint64 version,bool enabled,address payout,uint96 priceAtomic,bytes32 configHash,address pendingOwner))',
])
class ObservationFailure extends Error {
  constructor(public category: string) {
    super(category)
  }
}
class RpcFailure extends ObservationFailure {
  constructor(
    public data: unknown,
    code: number,
  ) {
    super(
      code === -32601 || code === -32602
        ? 'canonical_read_unsupported'
        : 'rpc_error',
    )
  }
}
export const observationPolicy = Object.freeze({
  maxFinalizedAgeMs: 30 * 60 * 1000,
  maxHeadAgeMs: 60 * 1000,
  maxFutureSkewMs: 1000,
  timeoutMs: 5000,
})
function fail(category: string): never {
  throw new ObservationFailure(category)
}

type Rpc = (method: string, params: unknown[]) => Promise<unknown>
function block(raw: unknown) {
  const b = raw as { hash: string; number: string; timestamp: string }
  if (
    !b ||
    !/^0x[0-9a-fA-F]{64}$/.test(b.hash) ||
    /^0x0{64}$/.test(b.hash) ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/.test(b.number) ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,15})$/.test(b.timestamp)
  )
    fail('rpc_malformed')
  return b
}
/** Provider observation only: no binding confirmation or payment authority. */
export async function readDeployment(rpc: Rpc, now: number | (() => number)) {
  const clock = typeof now === 'function' ? now : () => now
  const time = () => {
    const value = clock()
    if (!Number.isSafeInteger(value) || value <= 0) fail('clock_unavailable')
    return BigInt(value)
  }
  if ((await rpc('eth_chainId', [])) !== '0x2105') fail('wrong_chain')
  const finalized = block(
    await rpc('eth_getBlockByNumber', ['finalized', false]),
  )
  const age = time() - BigInt(finalized.timestamp) * 1000n
  if (
    age < -BigInt(observationPolicy.maxFutureSkewMs) ||
    age > BigInt(observationPolicy.maxFinalizedAgeMs)
  )
    fail('finality_stale')
  const head = block(await rpc('eth_getBlockByNumber', ['latest', false]))
  const headAge = time() - BigInt(head.timestamp) * 1000n
  if (
    headAge < -BigInt(observationPolicy.maxFutureSkewMs) ||
    headAge > BigInt(observationPolicy.maxHeadAgeMs)
  )
    fail('head_stale')
  if (
    BigInt(head.number) < BigInt(finalized.number) ||
    BigInt(head.timestamp) < BigInt(finalized.timestamp) ||
    BigInt(head.timestamp) - BigInt(finalized.timestamp) >
      BigInt(observationPolicy.maxFinalizedAgeMs / 1000)
  )
    fail('consistency_changed')

  const at = { blockHash: finalized.hash, requireCanonical: true }
  const code = await rpc('eth_getCode', [deployment.address, at])
  if (
    typeof code !== 'string' ||
    !/^0x(?:[0-9a-fA-F]{2}){1,24576}$/.test(code) ||
    keccak256(code as Hex) !== deployment.runtimeCodeHash
  )
    fail('runtime_mismatch')
  const chain = await rpc('eth_call', [
    {
      to: deployment.address,
      data: encodeFunctionData({ abi, functionName: 'CHAIN_ID' }),
    },
    at,
  ])
  if (
    typeof chain !== 'string' ||
    decodeFunctionResult({
      abi,
      functionName: 'CHAIN_ID',
      data: chain as Hex,
    }) !== 8453n
  )
    fail('wrong_chain')
  return {
    finalized,
    head,
    at,
    finalizedAgeSeconds: Number(age / 1000n),
    headAgeSeconds: Number(headAge / 1000n),
  }
}
export async function registryStatus(
  request: Request,
  config: ApiConfig,
  env: Record<string, unknown>,
  transport: typeof fetch = fetch,
  timeoutMs: number = observationPolicy.timeoutMs,
) {
  const active = await requireSession(request, config)
  if (request.method !== 'GET') throw new HttpError(405, 'Read only')
  const query = new URL(request.url).searchParams
  if (
    [...query.keys()].some((k) => k !== 'resourceId') ||
    query.getAll('resourceId').length > 1
  )
    throw new HttpError(422, 'Invalid registry filter')
  const id = query.get('resourceId')
  if (id && !/^[a-f0-9-]{36}$/.test(id))
    throw new HttpError(422, 'Invalid resource ID')
  const row = id
    ? await config.db
        .prepare(
          `SELECT r.payment_revision,r.upstream_url,r.response_config,r.price_atomic,r.payout_address,r.enabled,m.wallet_address,b.*,
    EXISTS(SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=r.id AND j.outcome='conflict') AS conflicted
    FROM api_resources r JOIN merchants m ON m.id=r.merchant_id LEFT JOIN resource_registry_bindings b ON b.resource_id=r.id
    WHERE r.id=? AND r.merchant_id=?`,
        )
        .bind(id, active.merchant_id)
        .first<Record<string, unknown>>()
    : null
  if (id && !row) throw new HttpError(404, 'Resource not found')
  const base = {
    ...deployment,
    runtimeObservation: 'unavailable',
    resourceStatus: id ? 'unconfirmed' : 'not_requested',
    productionAdmitted: false,
  }
  if (!env.REGISTRY_RPC_URL)
    return json({
      ...base,
      diagnostic: 'rpc_not_configured',
      reason: 'Server registry RPC is not configured',
    })
  const controller = new AbortController()
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < 1 ||
    timeoutMs > observationPolicy.timeoutMs
  )
    throw new HttpError(503, 'Invalid observation deadline')
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<never>((_resolve, reject) => {
    timer = setTimeout(() => {
      controller.abort()
      reject(new ObservationFailure('rpc_timeout'))
    }, timeoutMs)
  })
  try {
    const observe = async () => {
      let endpoint: string
      try {
        if (typeof env.REGISTRY_RPC_URL !== 'string')
          fail('configuration_invalid')
        endpoint = httpsUpstream(env.REGISTRY_RPC_URL)
      } catch {
        fail('configuration_invalid')
      }
      if (new URL(endpoint).search || new URL(endpoint).hash)
        fail('configuration_invalid')
      let sequence = 0
      const rpc: Rpc = async (method, params) => {
        if (controller.signal.aborted) fail('rpc_timeout')
        const callId = ++sequence
        const response = await transport(endpoint, {
          method: 'POST',
          redirect: 'manual',
          cache: 'no-store',
          signal: controller.signal,
          headers: {
            'Content-Type': 'application/json',
            Accept: 'application/json',
          },
          body: JSON.stringify({ jsonrpc: '2.0', id: callId, method, params }),
        })
        if (
          response.status !== 200 ||
          response.redirected ||
          !response.body ||
          response.headers
            .get('Content-Type')
            ?.split(';')[0]
            .trim()
            .toLowerCase() !== 'application/json'
        ) {
          void response.body?.cancel().catch(() => {})
          fail(response.status === 429 ? 'rpc_rate_limited' : 'rpc_http_error')
        }
        const reader = response.body.getReader()
        const cancel = () => {
          void reader.cancel().catch(() => {})
        }
        controller.signal.addEventListener('abort', cancel, { once: true })
        if (controller.signal.aborted) {
          cancel()
          fail('rpc_timeout')
        }
        let text = '',
          bytes = 0
        const decoder = new TextDecoder('utf-8', {
          fatal: true,
          ignoreBOM: true,
        })
        try {
          for (;;) {
            const part = await reader.read()
            if (part.done) break
            bytes += part.value.byteLength
            if (bytes > 131072) fail('rpc_response_limit')
            text += decoder.decode(part.value, { stream: true })
          }
          text += decoder.decode()
        } finally {
          void reader.cancel().catch(() => {})
          controller.signal.removeEventListener('abort', cancel)
          reader.releaseLock()
        }
        if (controller.signal.aborted) fail('rpc_timeout')
        let value
        try {
          value = JSON.parse(text)
        } catch {
          fail('rpc_malformed')
        }
        if (!value) fail('rpc_malformed')
        if (
          value.jsonrpc !== '2.0' ||
          value.id !== callId ||
          typeof value !== 'object' ||
          Array.isArray(value) ||
          Object.hasOwn(value, 'error') === Object.hasOwn(value, 'result')
        )
          fail('rpc_malformed')
        if (Object.hasOwn(value, 'error')) {
          if (!value.error || !Number.isInteger(value.error.code))
            fail('rpc_malformed')
          throw new RpcFailure(value.error.data, value.error.code)
        }
        return value.result
      }
      const { finalized, head, at, finalizedAgeSeconds, headAgeSeconds } =
        await readDeployment(rpc, Date.now)
      let resourceStatus = id ? 'not_bound' : 'not_requested'
      if (row?.onchain_resource_id) {
        resourceStatus = 'unconfirmed'
        if (
          row.registry_address &&
          String(row.registry_address).toLowerCase() ===
            deployment.address.toLowerCase() &&
          !row.conflicted &&
          row.review_conflicted !== 1
        ) {
          const derived = keccak256(
            encodeAbiParameters(
              [
                { type: 'bytes32' },
                { type: 'uint256' },
                { type: 'address' },
                { type: 'bytes16' },
              ],
              [
                keccak256(toHex('SignalArcGate.Resource.v1')),
                8453n,
                String(row.original_owner) as Hex,
                `0x${id!.replaceAll('-', '')}` as Hex,
              ],
            ),
          )
          const configHash = keccak256(
            encodeAbiParameters(
              [
                { type: 'bytes32' },
                { type: 'bytes32' },
                { type: 'bytes32' },
                { type: 'uint8' },
                { type: 'uint32' },
                { type: 'uint8' },
                { type: 'bytes32' },
              ],
              [
                keccak256(toHex('SignalArcGate.EndpointConfig.v1')),
                derived,
                keccak256(toHex(String(row.upstream_url))),
                1,
                JSON.parse(String(row.response_config)).maxBytes,
                0,
                String(row.config_salt) as Hex,
              ],
            ),
          )
          if (
            derived !== row.onchain_resource_id ||
            configHash !== row.config_hash
          )
            fail('binding_mismatch')
          const data = encodeFunctionData({
            abi,
            functionName: 'getResource',
            args: [String(row.onchain_resource_id) as Hex],
          })
          let raw: unknown
          try {
            raw = await rpc('eth_call', [{ to: deployment.address, data }, at])
          } catch (error) {
            const notFound =
              keccak256(toHex('ResourceNotFound(bytes32)')).slice(0, 10) +
              String(row.onchain_resource_id).slice(2)
            if (!(error instanceof RpcFailure) || error.data !== notFound)
              throw error
            raw = null
          }
          if (raw === null) resourceStatus = 'not_registered'
          else {
            const state = decodeFunctionResult({
              abi,
              functionName: 'getResource',
              data: raw as Hex,
            })
            const headRaw = await rpc('eth_call', [
              { to: deployment.address, data },
              { blockHash: head.hash, requireCanonical: true },
            ])
            const headCheck = block(
              await rpc('eth_getBlockByNumber', [head.number, false]),
            )
            if (
              headCheck.number !== head.number ||
              headCheck.hash !== head.hash ||
              headCheck.timestamp !== head.timestamp ||
              BigInt(head.number) < BigInt(finalized.number) ||
              BigInt(head.timestamp) < BigInt(finalized.timestamp) ||
              BigInt(head.timestamp) * 1000n > BigInt(Date.now() + 1000)
            )
              fail('consistency_changed')
            if (raw !== headRaw) resourceStatus = 'mismatch'
            else if (
              state.owner === '0x0000000000000000000000000000000000000000'
            )
              resourceStatus = 'not_registered'
            else if (
              raw === headRaw &&
              state.owner.toLowerCase() ===
                String(row.wallet_address).toLowerCase() &&
              state.payout.toLowerCase() ===
                String(row.payout_address).toLowerCase() &&
              state.priceAtomic.toString() === row.price_atomic &&
              state.configHash.toLowerCase() ===
                String(row.config_hash).toLowerCase() &&
              state.version.toString() === row.registry_version &&
              state.pendingOwner ===
                '0x0000000000000000000000000000000000000000' &&
              state.enabled &&
              row.enabled === 1
            )
              resourceStatus = 'matching_observation_only'
            else resourceStatus = 'mismatch'
          }
        }
      }
      const canonical = block(
        await rpc('eth_getBlockByNumber', [finalized.number, false]),
      )
      if (
        canonical.number !== finalized.number ||
        canonical.hash !== finalized.hash ||
        canonical.timestamp !== finalized.timestamp
      )
        fail('consistency_changed')
      const canonicalHead = block(
        await rpc('eth_getBlockByNumber', [head.number, false]),
      )
      if (
        canonicalHead.hash !== head.hash ||
        canonicalHead.number !== head.number ||
        canonicalHead.timestamp !== head.timestamp
      )
        fail('consistency_changed')
      if (
        Date.now() - Number(BigInt(finalized.timestamp) * 1000n) >
          observationPolicy.maxFinalizedAgeMs ||
        Date.now() - Number(BigInt(head.timestamp) * 1000n) >
          observationPolicy.maxHeadAgeMs
      )
        fail('finality_stale')
      if (id) {
        const current = await config.db
          .prepare(
            'SELECT r.payment_revision,b.generation FROM api_resources r LEFT JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=? AND r.merchant_id=?',
          )
          .bind(id, active.merchant_id)
          .first<{ payment_revision: number; generation: unknown }>()
        if (
          !current ||
          current.payment_revision !== row?.payment_revision ||
          current.generation !== row?.generation
        )
          fail('consistency_changed')
      }
      return json({
        ...base,
        runtimeObservation: 'matching_finalized_rpc_observation',
        resourceStatus,
        blockNumber: BigInt(finalized.number).toString(),
        finalizedAgeSeconds,
        headAgeSeconds,
        diagnostic: 'ok',
      })
    }
    return await Promise.race([observe(), timeout])
  } catch (error) {
    return json({
      ...base,
      diagnostic: controller.signal.aborted
        ? 'rpc_timeout'
        : error instanceof ObservationFailure
          ? error.category
          : 'observation_unavailable',
      reason: 'Registry observation unavailable or inconsistent',
    })
  } finally {
    clearTimeout(timer)
  }
}
