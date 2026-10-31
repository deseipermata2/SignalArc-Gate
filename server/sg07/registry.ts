import {
  decodeFunctionResult,
  encodeFunctionData,
  keccak256,
  parseAbi,
  type Hex,
} from 'viem'
import { walletAddress, resourceInput } from '../../shared/resources'
import { boundedJson, deadline, GatewayError } from '../sg05/bounds'
import { clockTime, type TrustedClock } from '../sg05/clock'
import { commitment, resourceId, USDC } from '../sg05/registry'

// Read subset of the actual SG04 ABI. Tests compare it to the compiler artifact.
export const registryAbi = parseAbi([
  'function CHAIN_ID() view returns (uint256)',
  'function getResource(bytes32 resourceId) view returns ((address owner,uint64 version,bool enabled,address payout,uint96 priceAtomic,bytes32 configHash,address pendingOwner))',
])
export interface RegistryPolicy {
  chainId: 8453
  asset: string
  address: string
  runtimeCodeHash: string
  finality: 'finalized'
  minConfirmations: number
  maxBlockAgeMs: number
}
export type ReadMethod =
  'eth_chainId' | 'eth_getBlockByNumber' | 'eth_getCode' | 'eth_call'
// Server-supplied capability only. No default RPC, environment lookup, signing or write methods.
export type RegistryRpc = (
  method: ReadMethod,
  params: unknown[],
  signal: AbortSignal,
) => Promise<unknown>
export interface ExpectedResource {
  uuid: string
  originalOwner: string
  currentOwner: string
  payout: string
  priceAtomic: string
  configHash: string
  version: string
  enabled: boolean
}
function fail(code = 'registry_unavailable'): never {
  throw new GatewayError(503, code)
}
const hashPattern = /^0x[0-9a-fA-F]{64}$/
function nonzeroHash(value: string) {
  if (!hashPattern.test(value) || /^0x0{64}$/.test(value))
    fail('registry_policy_invalid')
  return value.toLowerCase()
}
function quantity(value: unknown): bigint {
  if (
    typeof value !== 'string' ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(value)
  )
    fail('registry_rpc_malformed')
  return BigInt(value)
}
function block(value: unknown) {
  if (!value || typeof value !== 'object') fail('registry_block_unavailable')
  const v = value as Record<string, unknown>
  if (
    typeof v.hash !== 'string' ||
    !hashPattern.test(v.hash) ||
    /^0x0{64}$/.test(v.hash)
  )
    fail('registry_rpc_malformed')
  return {
    hash: v.hash.toLowerCase(),
    number: quantity(v.number),
    timestamp: quantity(v.timestamp),
  }
}
export function validateRegistryPolicy(p: RegistryPolicy) {
  try {
    if (
      p.chainId !== 8453 ||
      p.asset.toLowerCase() !== USDC.toLowerCase() ||
      p.finality !== 'finalized' ||
      !Number.isSafeInteger(p.minConfirmations) ||
      p.minConfirmations < 1 ||
      p.minConfirmations > 100000 ||
      !Number.isSafeInteger(p.maxBlockAgeMs) ||
      p.maxBlockAgeMs < 1000 ||
      p.maxBlockAgeMs > 3600000
    )
      fail('registry_policy_invalid')
    return {
      ...p,
      address: walletAddress(p.address),
      runtimeCodeHash: nonzeroHash(p.runtimeCodeHash),
    }
  } catch {
    return fail('registry_policy_invalid')
  }
}
/** Read-only observation, NOT evidence admission or permission to release content. */
export function createRegistryReader(
  policy: RegistryPolicy,
  rpc: RegistryRpc,
  clock: TrustedClock,
) {
  const p = validateRegistryPolicy(policy)
  return async (expected: ExpectedResource) => {
    const started = await clockTime(clock)
    try {
      return await deadline(async (signal) => {
        const call = async (method: ReadMethod, params: unknown[]) => {
          if (signal.aborted) fail()
          const result = await rpc(method, params, signal)
          // Bound before decoding ABI. Transport must additionally bound bytes before JSON parsing.
          boundedJson(JSON.stringify(result), 131072, 65536)
          if (signal.aborted || (await clockTime(clock)) - started >= 5000)
            fail('registry_timeout')
          return result
        }
        const original = walletAddress(expected.originalOwner),
          owner = walletAddress(expected.currentOwner),
          payout = walletAddress(expected.payout)
        const id = resourceId(original, expected.uuid)
        if (
          /^0{32}$/.test(expected.uuid.replaceAll('-', '')) ||
          !expected.enabled ||
          !/^[1-9]\d{0,11}$/.test(expected.priceAtomic) ||
          !/^[1-9]\d{0,19}$/.test(expected.version) ||
          BigInt(expected.version) > 2n ** 64n - 1n
        )
          fail('registry_expected_invalid')
        nonzeroHash(expected.configHash)
        if (quantity(await call('eth_chainId', [])) !== 8453n)
          fail('registry_wrong_chain')
        const finalized = block(
          await call('eth_getBlockByNumber', ['finalized', false]),
        )
        const latest = block(
          await call('eth_getBlockByNumber', ['latest', false]),
        )
        const now = BigInt(await clockTime(clock)),
          timestamp = finalized.timestamp * 1000n
        if (
          latest.number < finalized.number ||
          latest.number - finalized.number + 1n < BigInt(p.minConfirmations) ||
          timestamp > now + 1000n ||
          now - timestamp > BigInt(p.maxBlockAgeMs)
        )
          fail('registry_not_final')
        const at = { blockHash: finalized.hash, requireCanonical: true }
        const code = await call('eth_getCode', [p.address, at])
        if (
          typeof code !== 'string' ||
          !/^0x(?:[0-9a-fA-F]{2}){1,24576}$/.test(code) ||
          keccak256(code as Hex).toLowerCase() !== p.runtimeCodeHash
        )
          fail('registry_code_mismatch')
        const chainRaw = await call('eth_call', [
          {
            to: p.address,
            data: encodeFunctionData({
              abi: registryAbi,
              functionName: 'CHAIN_ID',
            }),
          },
          at,
        ])
        if (
          typeof chainRaw !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(chainRaw) ||
          decodeFunctionResult({
            abi: registryAbi,
            functionName: 'CHAIN_ID',
            data: chainRaw as Hex,
          }) !== 8453n
        )
          fail('registry_wrong_chain')
        const raw = await call('eth_call', [
          {
            to: p.address,
            data: encodeFunctionData({
              abi: registryAbi,
              functionName: 'getResource',
              args: [id],
            }),
          },
          at,
        ])
        if (typeof raw !== 'string' || !/^0x[0-9a-fA-F]{448}$/.test(raw))
          fail('registry_rpc_malformed')
        const state = decodeFunctionResult({
          abi: registryAbi,
          functionName: 'getResource',
          data: raw as Hex,
        })
        if (
          state.owner.toLowerCase() !== owner.toLowerCase() ||
          state.pendingOwner !== '0x0000000000000000000000000000000000000000' ||
          state.payout.toLowerCase() !== payout.toLowerCase() ||
          state.priceAtomic.toString() !== expected.priceAtomic ||
          state.version.toString() !== expected.version ||
          state.configHash.toLowerCase() !==
            expected.configHash.toLowerCase() ||
          !state.enabled
        )
          fail('registry_configuration_mismatch')
        // Detect canonical hash movement during the read. No fallback to latest/number-only calls.
        const recheck = block(
          await call('eth_getBlockByNumber', [
            `0x${finalized.number.toString(16)}`,
            false,
          ]),
        )
        if (
          recheck.hash !== finalized.hash ||
          recheck.number !== finalized.number ||
          recheck.timestamp !== finalized.timestamp
        )
          fail('registry_reorg_uncertain')
        return {
          resourceId: id,
          registry: p.address,
          ...state,
          priceAtomic: state.priceAtomic.toString(),
          version: state.version.toString(),
          blockHash: finalized.hash,
          blockNumber: finalized.number.toString(),
          observedAt: await clockTime(clock),
          evidence: 'rpc_observation_only' as const,
        }
      }, 5000)
    } catch (error) {
      if (error instanceof GatewayError) throw error
      return fail()
    }
  }
}
/** Read D1 expectations only; never ingest client observations or manufacture confirmations. */
export async function registryExpectation(
  db: D1Database,
  uuid: string,
  policy: RegistryPolicy,
  clock: TrustedClock,
): Promise<ExpectedResource> {
  const p = validateRegistryPolicy(policy)
  const row = await db
    .prepare(
      `SELECT r.*, m.wallet_address AS current_owner, b.original_owner, b.onchain_resource_id, b.registry_address, b.config_salt, b.config_hash, b.registry_version, b.source, b.block_hash, b.block_number, b.checked_at FROM api_resources r JOIN merchants m ON m.id = r.merchant_id JOIN resource_registry_bindings b ON b.resource_id = r.id WHERE r.id = ?`,
    )
    .bind(uuid)
    .first<Record<string, unknown>>()
  if (
    !row ||
    row.source !== 'onchain_confirmed' ||
    typeof row.registry_address !== 'string' ||
    row.registry_address.toLowerCase() !== p.address.toLowerCase() ||
    !hashPattern.test(String(row.block_hash)) ||
    !/^(?:0|[1-9]\d*)$/.test(String(row.block_number))
  )
    fail('registry_binding_unconfirmed')
  const now = await clockTime(clock)
  if (
    !Number.isSafeInteger(row.checked_at) ||
    now - Number(row.checked_at) > 300000 ||
    Number(row.checked_at) > now + 1000
  )
    fail('registry_binding_stale')
  const resource = resourceInput({
    name: row.name,
    upstreamUrl: row.upstream_url,
    responseConfig: JSON.parse(String(row.response_config)),
    priceAtomic: row.price_atomic,
    payoutAddress: row.payout_address,
    network: row.network,
    enabled: row.enabled === 1,
  })
  const id = resourceId(String(row.original_owner), uuid)
  const hash = commitment(
    id,
    resource.upstreamUrl,
    resource.responseConfig.maxBytes,
    String(row.config_salt),
  )
  if (row.onchain_resource_id !== id || row.config_hash !== hash)
    fail('registry_binding_mismatch')
  return {
    uuid,
    originalOwner: String(row.original_owner),
    currentOwner: String(row.current_owner),
    payout: resource.payoutAddress,
    priceAtomic: resource.priceAtomic,
    version: String(row.registry_version),
    configHash: hash,
    enabled: resource.enabled,
  }
}
