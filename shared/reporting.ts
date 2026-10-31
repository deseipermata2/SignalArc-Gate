export const paymentPhases = [
  'created',
  'rejected',
  'verifying',
  'verified',
  'settlement_pending',
  'settlement_unknown',
  'settled',
  'failed',
  'fulfilling',
  'fulfilled',
  'fulfillment_failed',
  'legacy_unreconciled',
] as const
export type PaymentPhase = (typeof paymentPhases)[number]
export const phaseLabels: Record<PaymentPhase, string> = {
  created: 'Challenge created',
  rejected: 'Authorization rejected',
  verifying: 'Verification in progress',
  verified: 'Verified; not settled',
  settlement_pending: 'Settlement pending',
  settlement_unknown: 'Settlement unknown — reconcile before retry',
  settled: 'Settlement reported',
  failed: 'Failed before confirmed settlement',
  fulfilling: 'Delivery in progress',
  fulfilled: 'Response release recorded',
  fulfillment_failed: 'Settlement reported; delivery failed',
  legacy_unreconciled: 'Legacy state — unverified',
}
export type Provenance = 'local_simulation' | 'unverified'
export type ReportSource =
  'all' | 'local_simulation' | 'unverified' | 'verified'
export interface AttemptReport {
  id: string
  resourceId: string
  resourceName: string
  phase: PaymentPhase
  requestedAmountAtomic: string
  provenance: Provenance
  createdAt: number
  updatedAt: number
}
export interface ReceiptReport {
  id: string
  attemptId: string
  resourceId: string
  resourceName: string
  phase: PaymentPhase
  provenance: Provenance
  requestedAmountAtomic: string
  amountAtomic: string | null
  transactionReference: string | null
  createdAt: number
}
export interface ReportPage<T> {
  items: T[]
  nextCursor: string | null
}
export interface ReportSummary {
  window: { from: string; to: string }
  verified: {
    available: false
    settlements: null
    amountAtomic: null
    reason: string
  }
  attempts: {
    total: number
    localSimulation: number
    unverified: number
    byPhase: Partial<Record<PaymentPhase, number>>
  }
  receipts: {
    localSimulation: number
    localSimulationAmountAtomic: string
    unverified: number
  }
}
