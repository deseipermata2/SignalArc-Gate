import type { SettleResponse } from '@x402/core/types'
import { GatewayError } from './bounds'
import { NETWORK, USDC } from './registry'
import { validSettlement } from './protocol'
import { PaymentStore } from './store'
export interface LocalEvidence {
  localSimulationOnly: true
  identity: string
  network: string
  asset: string
  recipient: string
  amount: string
  payer: string
  disposition: 'settled' | 'not_submitted' | 'unknown'
  settlement?: SettleResponse
}
/** Internal operator service. No public route and no invented CDP status endpoint. */
export async function reconcileUnknown(
  store: PaymentStore,
  id: string,
  lookup: (identity: string) => Promise<LocalEvidence>,
) {
  const attempt = await store.get(id)
  if (
    !attempt ||
    attempt.phase !== 'settlement_unknown' ||
    !attempt.authorization_key ||
    !attempt.buyer_address
  )
    throw new GatewayError(409, 'attempt_not_reconcilable')
  const evidence = await lookup(attempt.authorization_key)
  if (
    evidence.localSimulationOnly !== true ||
    evidence.identity !== attempt.authorization_key ||
    evidence.network !== NETWORK ||
    evidence.asset.toLowerCase() !== USDC.toLowerCase() ||
    evidence.recipient.toLowerCase() !== attempt.recipient.toLowerCase() ||
    evidence.payer.toLowerCase() !== attempt.buyer_address ||
    evidence.amount !== attempt.amount_atomic
  )
    throw new GatewayError(503, 'reconciliation_evidence_mismatch')
  if (
    evidence.disposition === 'settled' &&
    evidence.settlement &&
    validSettlement(
      evidence.settlement,
      attempt.buyer_address,
      attempt.amount_atomic,
      attempt.recipient,
    )
  ) {
    if (
      !(await store.settle(attempt, evidence.settlement, 'settlement_unknown'))
    )
      throw new GatewayError(409, 'reconciliation_raced')
    return 'settled'
  }
  if (evidence.disposition === 'not_submitted') {
    if (
      !(await store.advance(
        id,
        'settlement_unknown',
        'failed',
        'authoritatively_not_submitted',
      ))
    )
      throw new GatewayError(409, 'reconciliation_raced')
    return 'failed'
  }
  return 'settlement_unknown'
}
