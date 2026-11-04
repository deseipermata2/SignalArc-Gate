import { decodeFunctionData, type Hex } from 'viem'
import { createSettlementAdmissionReview } from '../../server/sg07/settlement-admission'
import type { Attempt } from '../../server/sg05/store'
import type { SettleResponse } from '@x402/core/types'
import type { RegistryRpc } from '../../server/sg07/registry'
import { usdcEvidenceAbi } from '../../server/sg07/settlement-evidence'
import type { LocalPilotAuthority } from '../../server/sg07/internal-manifest'
import { createSettlementObserver } from '../../server/sg07/settlement-evidence'
import { USDC, NETWORK } from '../../server/sg05/registry'
import { boundedJson, deadline, GatewayError } from '../../server/sg05/bounds'
import type { TrustedClock } from '../../server/sg05/clock'

/** Fixture-only transport; production Functions never import this file. */
export function localChainVerifier(
  origin: string,
  clock: TrustedClock,
): LocalPilotAuthority['verifySettlement'] {
  return async (a, result) =>
    deadline(async (signal) => {
      if (
        !a.authorization_key ||
        !a.authorization_fingerprint ||
        !a.buyer_address
      )
        throw new GatewayError(503, 'local_chain_evidence_unavailable')
      const { rpc } = await localChainRead(origin, a, result, signal)
      const observe = createSettlementObserver(localEvidencePolicy, rpc, clock)
      const evidence = await observe(
        {
          authorizationKey: a.authorization_key,
          authorizationFingerprint: a.authorization_fingerprint,
          payer: a.buyer_address,
          recipient: a.recipient,
          amount: a.amount_atomic,
          asset: a.asset,
          network: NETWORK,
        },
        result.transaction,
      )
      if (
        evidence.sourceId !== 'LOCAL_SIMULATION_ONLY' ||
        evidence.productionAdmitted !== false
      )
        throw new GatewayError(503, 'local_chain_evidence_unavailable')
    })
}

export const localEvidencePolicy = Object.freeze({
  chainId: 8453 as const,
  asset: USDC,
  finality: 'finalized' as const,
  minConfirmations: 2,
  maxBlockAgeMs: 60000,
  sourceId: 'LOCAL_SIMULATION_ONLY',
})
export async function localChainRead(
  origin: string,
  a: Attempt,
  result: SettleResponse,
  signal: AbortSignal,
) {
  const response = await fetch(origin + '/chain', {
    method: 'POST',
    signal,
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ identity: a.authorization_key }),
  })
  const f = boundedJson(await response.text(), 32768, 8192) as {
    localSimulationOnly: unknown
    chainId: unknown
    finalized: { hash: string }
    canonical: unknown
    tx: unknown
    receipt: unknown
    state: unknown
  }
  if (
    !response.ok ||
    f?.localSimulationOnly !== true ||
    a.evidence_kind !== 'local_simulation' ||
    !a.authorization_key ||
    !a.authorization_fingerprint ||
    !a.buyer_address
  )
    throw new GatewayError(503, 'local_chain_evidence_unavailable')
  const rpc: RegistryRpc = async (method, params) => {
    if (method === 'eth_chainId') return f.chainId
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'finalized' || params[0] === '0x66') return f.finalized
      if (params[0] === '0x64') return f.canonical
    }
    if (
      method === 'eth_getTransactionReceipt' &&
      params[0] === result.transaction
    )
      return f.receipt
    if (
      method === 'eth_getTransactionByHash' &&
      params[0] === result.transaction
    )
      return f.tx
    if (
      method === 'eth_call' &&
      JSON.stringify(params[1]) ===
        JSON.stringify({
          blockHash: f.finalized.hash,
          requireCanonical: true,
        })
    )
      return f.state
    throw new Error('Unsupported fixture read')
  }
  const input = f.tx as { input: Hex }
  const decoded = decodeFunctionData({
    abi: usdcEvidenceAbi,
    data: input.input,
  })
  const nonce = String(decoded.args?.[5])
  return { rpc, nonce }
}
export function localReconciliationAdmission(
  db: D1Database,
  origin: string,
  mockOrigin: string,
  clock: TrustedClock,
): LocalPilotAuthority['verifySettlement'] {
  return (a, result) =>
    deadline(async (signal) => {
      const { rpc, nonce } = await localChainRead(mockOrigin, a, result, signal)
      const review = createSettlementAdmissionReview(
        db,
        { origin, realm: 'local_simulation', optIn: true },
        localEvidencePolicy,
        rpc,
        clock,
      )
      const candidate = await review.prepare(
        a.merchant_id,
        a.id,
        result.transaction,
        nonce,
      )
      await review.consume(candidate, a.merchant_id, a.id)
    })
}
