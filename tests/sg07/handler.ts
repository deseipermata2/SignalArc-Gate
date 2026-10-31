import {
  createRegistryReader,
  registryExpectation,
  type RegistryPolicy,
  type ExpectedResource,
} from '../../server/sg07/registry'
import { createReadRpc } from '../../server/sg07/rpc'
import { productionUpstream } from '../../server/sg07/upstream'
import { createFacilitatorAdapter } from '../../server/sg07/facilitator'
import { registryAbi } from '../../server/sg07/registry'
import { USDC, resourceId } from '../../server/sg05/registry'
import { resourceInfo } from '../../server/sg05/protocol'
import {
  encodeFunctionResult,
  encodeFunctionData,
  keccak256,
  type Hex,
  recoverTypedDataAddress,
} from 'viem'
import { readJson } from '../../server/sg03/http'
import type { PaymentRequirements } from '@x402/core/types'

globalThis.fetch = async () => {
  throw Error('SG07 fixture forbids live egress')
}
const addr = '0x00000000000000000000000000000000000a11ce'
const zero = '0x0000000000000000000000000000000000000000'
const code = '0x60006000' as Hex // Explicit simulated bytecode; never a deployment claim.
const hash = '0x' + '11'.repeat(32)
const blockHash = '0x' + '22'.repeat(32)
export const expected: ExpectedResource = {
  uuid: '8dc286d7-8b04-4411-96a0-422aad965f31',
  originalOwner: addr,
  currentOwner: addr,
  payout: addr,
  priceAtomic: '1000',
  version: '1',
  configHash: hash,
  enabled: true,
}
export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Record<string, unknown> & { SIGNALARC_DB: D1Database }
}) {
  const url = new URL(request.url),
    db = env.SIGNALARC_DB
  if (
    env.APP_ENV !== 'local' ||
    env.SG07_LOCAL_ONLY !== 'yes' ||
    url.hostname !== '127.0.0.1' ||
    url.origin !== env.APP_ORIGIN ||
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes' ||
    (await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db'
  )
    return new Response('Unavailable', { status: 404 })
  const body = (await readJson(request)) as {
    mode: string
    header?: string
    payer?: string
  }
  let now = Date.now(),
    calls = 0
  const clock = async () => now
  const policy: RegistryPolicy = {
    chainId: 8453,
    asset: USDC,
    address: addr,
    runtimeCodeHash: keccak256(code),
    finality: 'finalized',
    minConfirmations: 2,
    maxBlockAgeMs: 3600000,
  }
  try {
    if (url.pathname === '/sg07/upstream') {
      productionUpstream(body.mode)
    }
    if (url.pathname === '/sg07/binding') {
      await registryExpectation(db, expected.uuid, policy, clock)
      throw Error('Missing binding accepted')
    }
    if (url.pathname === '/sg07/registry') {
      const e = { ...expected },
        p = { ...policy }
      if (body.mode === 'missing-address') p.address = ''
      if (body.mode === 'zero-address') p.address = zero
      if (body.mode === 'wrong-chain-policy') p.chainId = 1 as 8453
      if (body.mode === 'wrong-token') p.asset = addr
      if (body.mode === 'missing-codehash') p.runtimeCodeHash = ''
      if (body.mode === 'no-finality') p.finality = 'latest' as 'finalized'
      if (body.mode === 'bad-depth') p.minConfirmations = 0
      if (body.mode === 'disabled-d1') e.enabled = false
      if (body.mode === 'zero-uuid')
        e.uuid = '00000000-0000-0000-0000-000000000000'
      const rpc = createReadRpc(
        'https://rpc.example.com',
        async (_input, init) => {
          calls++
          const query = JSON.parse(String(init?.body))
          const { method, params, id } = query
          if (body.mode === 'hung') return new Promise<Response>(() => {})
          if (body.mode === 'timeout') now += 3000
          if (body.mode === 'http') return new Response('', { status: 503 })
          if (body.mode === 'redirect')
            return Response.redirect('https://metadata.invalid', 302)
          if (body.mode === 'malformed')
            return Response.json({ error: 'private provider details' })
          if (body.mode === 'oversized')
            return Response.json({ value: 'x'.repeat(131073) })
          let result: unknown
          if (method === 'eth_chainId')
            result = body.mode === 'wrong-chain' ? '0x1' : '0x2105'
          else if (method === 'eth_getBlockByNumber') {
            const latest = params[0] === 'latest'
            result = {
              number: latest ? '0x66' : '0x64',
              hash:
                body.mode === 'reorg' && params[0] === '0x64'
                  ? '0x' + '33'.repeat(32)
                  : blockHash,
              timestamp:
                '0x' +
                Math.floor(
                  (now - (body.mode === 'stale-block' ? 3601000 : 60000)) /
                    1000,
                ).toString(16),
            }
            if (body.mode === 'unconfirmed')
              (result as Record<string, unknown>).number = '0x66'
            if (body.mode === 'null-block') result = null
            if (body.mode === 'bad-quantity')
              (result as Record<string, unknown>).number = '0x00'
          } else {
            if (
              params[1].blockHash !== blockHash ||
              params[1].requireCanonical !== true
            )
              throw Error('Unpinned read')
            if (method === 'eth_getCode')
              result = body.mode === 'code-mismatch' ? '0x00' : code
            else if (
              params[0].data ===
              encodeFunctionData({ abi: registryAbi, functionName: 'CHAIN_ID' })
            )
              result = encodeFunctionResult({
                abi: registryAbi,
                functionName: 'CHAIN_ID',
                result: 8453n,
              })
            else {
              if (
                params[0].data !==
                encodeFunctionData({
                  abi: registryAbi,
                  functionName: 'getResource',
                  args: [resourceId(e.originalOwner, e.uuid)],
                })
              )
                throw Error('Wrong resource identity')
              result = encodeFunctionResult({
                abi: registryAbi,
                functionName: 'getResource',
                result: {
                  owner: body.mode === 'transferred' ? USDC : addr,
                  pendingOwner: body.mode === 'pending-transfer' ? USDC : zero,
                  version: body.mode === 'stale-version' ? 2n : 1n,
                  enabled: body.mode !== 'disabled-chain',
                  payout: body.mode === 'wrong-payout' ? USDC : addr,
                  priceAtomic: body.mode === 'wrong-price' ? 1001n : 1000n,
                  configHash: (body.mode === 'wrong-hash'
                    ? '0x' + '44'.repeat(32)
                    : hash) as Hex,
                },
              })
              if (body.mode === 'bad-abi') result = '0x01'
            }
          }
          return Response.json({
            jsonrpc: '2.0',
            id: body.mode === 'wrong-rpc-id' ? id + 1 : id,
            result,
            ...(body.mode === 'rpc-error'
              ? { error: { code: -1, message: 'secret provider diagnostic' } }
              : {}),
          })
        },
        clock,
      )
      const result = await createRegistryReader(p, rpc, clock)(e)
      return Response.json({ localSimulationOnly: true, result, calls })
    }
    if (url.pathname === '/sg07/facilitator') {
      const required: PaymentRequirements = {
        scheme: 'exact',
        network: 'eip155:8453',
        asset: USDC,
        amount: '1000',
        payTo: addr,
        maxTimeoutSeconds: 60,
        extra: {
          name: 'USD Coin',
          version: '2',
          paymentFlow: 'upfront',
          assetTransferMethod: 'eip3009',
        },
      }
      if (body.mode === 'wrong-token') required.asset = addr
      let verifyCalls = 0,
        settleCalls = 0
      const adapter = createFacilitatorAdapter(
        {
          verify: async (payload) => {
            verifyCalls++
            const a = payload.payload.authorization as Record<string, string>
            const signer = await recoverTypedDataAddress({
              domain: {
                name: 'USD Coin',
                version: '2',
                chainId: 8453,
                verifyingContract: USDC,
              },
              types: {
                TransferWithAuthorization: [
                  { name: 'from', type: 'address' },
                  { name: 'to', type: 'address' },
                  { name: 'value', type: 'uint256' },
                  { name: 'validAfter', type: 'uint256' },
                  { name: 'validBefore', type: 'uint256' },
                  { name: 'nonce', type: 'bytes32' },
                ],
              },
              primaryType: 'TransferWithAuthorization',
              message: {
                from: a.from as Hex,
                to: a.to as Hex,
                value: BigInt(a.value),
                validAfter: BigInt(a.validAfter),
                validBefore: BigInt(a.validBefore),
                nonce: a.nonce as Hex,
              },
              signature: payload.payload.signature as Hex,
            })
            return {
              isValid:
                body.mode !== 'invalid-verification' &&
                signer.toLowerCase() === body.payer?.toLowerCase(),
              payer: signer,
            }
          },
          settle: async () => {
            settleCalls++
            if (body.mode === 'ambiguous')
              throw Error('secret provider diagnostic')
            return {
              success: true,
              network:
                body.mode === 'wrong-settlement-network'
                  ? 'eip155:1'
                  : 'eip155:8453',
              transaction: '0x' + '55'.repeat(32),
              payer: body.payer,
              amount: body.mode === 'wrong-settlement-amount' ? '1001' : '1000',
            }
          },
        },
        clock,
      )
      await db
        .prepare(
          'CREATE TABLE IF NOT EXISTS sg07_claims (id TEXT PRIMARY KEY, state TEXT NOT NULL)',
        )
        .run()
      const id = crypto.randomUUID()
      await db
        .prepare('INSERT INTO sg07_claims VALUES (?, ?)')
        .bind(id, 'verified')
        .run()
      try {
        const permit = await adapter.verify(
          body.header ?? '',
          required,
          'http://127.0.0.1/sg07/local-only',
        )
        const claim = async () =>
          (
            await db
              .prepare('UPDATE sg07_claims SET state=? WHERE id=? AND state=?')
              .bind('settlement_pending', id, 'verified')
              .run()
          ).meta.changes === 1
        const results = await Promise.allSettled([
          adapter.settleAfterClaim(permit, claim),
          adapter.settleAfterClaim(permit, claim),
        ])
        const values = results.map((r) =>
          r.status === 'fulfilled' ? r.value : { rejected: true },
        )
        const state = await db
          .prepare('SELECT state FROM sg07_claims WHERE id=?')
          .bind(id)
          .first()
        return Response.json({
          localSimulationOnly: true,
          verifyCalls,
          settleCalls,
          values,
          state,
          metadata: resourceInfo('http://127.0.0.1/sg07/local-only'),
        })
      } catch {
        return Response.json(
          { rejected: true, verifyCalls, settleCalls },
          { status: 402 },
        )
      } finally {
        await db.prepare('DELETE FROM sg07_claims WHERE id=?').bind(id).run()
      }
    }
    return new Response('Unknown fixture', { status: 404 })
  } catch (error) {
    const code =
      error && typeof error === 'object' && 'code' in error
        ? String(error.code)
        : 'readiness_unavailable'
    return Response.json({ error: code, calls }, { status: 503 })
  }
}
