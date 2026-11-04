import { hash } from '../sg03/http'
import { canonical, deadline, GatewayError } from '../sg05/bounds'
import { clockTime, monotonicClock, type TrustedClock } from '../sg05/clock'
import { NETWORK, USDC } from '../sg05/registry'
import { PaymentStore, type Attempt } from '../sg05/store'
import type { RegistryRpc } from './registry'
import {
  createSettlementObserver,
  type SettlementEvidencePolicy,
} from './settlement-evidence'
import { reviewUnknownSettlement } from './settlement-review'

function fail(code = 'settlement_admission_unavailable'): never {
  throw new GatewayError(503, code)
}
export interface AdmissionReviewProfile {
  origin: string
  optIn: boolean
  realm: 'local_simulation'
}
/**
 * Read-only proof + durable review checkpoint, NOT production receipt authority.
 * No HTTP handler, credential lookup, SDK success input or settlement submission.
 * Production approval/provenance is intentionally not constructible here.
 */
export function createSettlementAdmissionReview(
  db: D1Database,
  profile: AdmissionReviewProfile,
  policy: SettlementEvidencePolicy,
  rpc: RegistryRpc,
  readClock: TrustedClock,
) {
  const origin = new URL(profile.origin)
  if (
    profile.realm !== 'local_simulation' ||
    !profile.optIn ||
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.origin !== profile.origin ||
    policy.sourceId !== 'LOCAL_SIMULATION_ONLY'
  )
    fail()
  const clock = monotonicClock(readClock)
  const pinnedPolicy = Object.freeze({ ...policy })
  const store = new PaymentStore(db, clock)
  type Checkpoint = {
    attempt: Attempt
    reviewId: string
    evidenceJson: string
    transaction: string
    expiresAt: number
  }
  const issued = new WeakMap<object, Checkpoint>()
  const guard = async () => {
    if ((await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db')
      fail()
  }
  const unchanged = async (a: Attempt) => {
    const current = await store.get(a.id)
    if (!current || canonical(current) !== canonical(a))
      fail('settlement_admission_raced')
  }
  return {
    async prepare(
      merchantId: string,
      attemptId: string,
      transaction: string,
      nonce: string,
    ) {
      return deadline(async (signal) => {
        await guard()
        if (signal.aborted) fail()
        if (
          !/^[a-f0-9-]{36}$/.test(merchantId) ||
          !/^[a-f0-9-]{36}$/.test(attemptId) ||
          !/^0x[0-9a-fA-F]{64}$/.test(nonce)
        )
          fail()
        const a = await store.get(attemptId)
        if (
          !a ||
          a.merchant_id !== merchantId ||
          a.phase !== 'settlement_unknown' ||
          a.evidence_kind !== 'local_simulation' ||
          !a.buyer_address ||
          !a.authorization_key ||
          !a.authorization_fingerprint ||
          a.asset.toLowerCase() !== USDC.toLowerCase()
        )
          fail()
        const identity = await hash(
          canonical([
            NETWORK,
            USDC.toLowerCase(),
            a.buyer_address!.toLowerCase(),
            nonce.toLowerCase(),
          ]),
        )
        if (identity !== a.authorization_key) fail('settlement_nonce_mismatch')
        if (signal.aborted) fail()
        const observer = createSettlementObserver(
          pinnedPolicy,
          (method, params, rpcSignal) => {
            if (signal.aborted) fail()
            return rpc(method, params, rpcSignal)
          },
          clock,
        )
        const observed = await observer(
          {
            authorizationKey: a.authorization_key!,
            authorizationFingerprint: a.authorization_fingerprint!,
            payer: a.buyer_address!,
            recipient: a.recipient,
            amount: a.amount_atomic,
            asset: a.asset,
            network: NETWORK,
          },
          transaction,
        )
        if (
          observed.authorizationNonce !== nonce.toLowerCase() ||
          observed.productionAdmitted !== false ||
          observed.sourceId !== 'LOCAL_SIMULATION_ONLY'
        )
          fail()
        await unchanged(a)
        if (signal.aborted) fail()
        const review = await reviewUnknownSettlement(
          store,
          merchantId,
          attemptId,
          transaction,
          async () => observed,
          clock,
        )
        if (signal.aborted) fail()
        if (review.outcome !== 'rpc_observation_only')
          fail('settlement_conflict_quarantined')
        await unchanged(a)
        if (signal.aborted) fail()
        const data = Object.fromEntries(
          Object.entries(observed).filter(([key]) => key !== 'sourceId'),
        )
        // Reproduce the existing append-only journal representation exactly.
        const evidenceJson = canonical({
          ...data,
          provenance: 'LOCAL SIMULATION ONLY',
        })
        const candidate = Object.freeze({
          stage: 'review_only' as const,
          reviewId: review.id,
          productionAdmitted: false as const,
          localSimulationOnly: true as const,
        })
        const expiresAt = (await clockTime(clock)) + 10000
        if (signal.aborted) fail()
        issued.set(candidate, {
          attempt: a,
          reviewId: review.id,
          evidenceJson,
          transaction: transaction.toLowerCase(),
          expiresAt,
        })
        return candidate
      }, 6000)
    },
    async consume(candidate: object, merchantId: string, attemptId: string) {
      // A JSON clone, forged flag, database ID or another instance's object is not a permit.
      const checkpoint = issued.get(candidate)
      issued.delete(candidate)
      if (!checkpoint) fail('settlement_candidate_untrusted')
      return deadline(async (signal) => {
        await guard()
        if (signal.aborted) fail()
        const c = checkpoint,
          a = c.attempt
        if (
          a.id !== attemptId ||
          a.merchant_id !== merchantId ||
          (await clockTime(clock)) >= c.expiresAt
        )
          fail('settlement_candidate_stale')
        await unchanged(a)
        if (signal.aborted) fail()
        const row = await db
          .prepare(
            `SELECT id FROM settlement_evidence_observations s WHERE s.id=? AND s.attempt_id=? AND s.merchant_id=? AND s.resource_id=? AND s.authorization_key=? AND s.authorization_fingerprint=? AND lower(s.transaction_hash)=? AND s.evidence_json=? AND s.outcome='rpc_observation_only' AND s.provenance='local_simulation' AND s.source_id='LOCAL_SIMULATION_ONLY' AND NOT EXISTS (SELECT 1 FROM settlement_evidence_observations q WHERE q.attempt_id=s.attempt_id AND q.outcome='conflict')`,
          )
          .bind(
            c.reviewId,
            a.id,
            a.merchant_id,
            a.resource_id,
            a.authorization_key,
            a.authorization_fingerprint,
            c.transaction,
            c.evidenceJson,
          )
          .first()
        if (!row) fail('settlement_conflict_quarantined')
        await unchanged(a)
        if (signal.aborted) fail()
        return Object.freeze({
          reviewId: c.reviewId,
          productionAdmitted: false as const,
          localSimulationOnly: true as const,
        })
      })
    },
  }
}
