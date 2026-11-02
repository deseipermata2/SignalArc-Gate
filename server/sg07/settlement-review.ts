import { boundedJson, canonical, GatewayError } from '../sg05/bounds'
import { clockTime, type TrustedClock } from '../sg05/clock'
import { NETWORK, USDC } from '../sg05/registry'
import type { PaymentStore } from '../sg05/store'
import type { SettlementExpectation } from './settlement-evidence'

interface Observation {
  evidence: 'rpc_observation_only'
  productionAdmitted: false
  sourceId: string
  transaction: string
  blockNumber: string
  blockHash: string
  finalizedBlockHash: string
  finalizedBlockNumber: string
  authorizationKey: string
  authorizationFingerprint: string
  network: string
  asset: string
  payer: string
  recipient: string
  amount: string
}

function validObservation(value: unknown): value is Observation {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const v = value as Record<string, unknown>
  return (
    v.evidence === 'rpc_observation_only' &&
    v.productionAdmitted === false &&
    typeof v.sourceId === 'string' &&
    /^[A-Za-z0-9_.:-]{1,100}$/.test(v.sourceId) &&
    typeof v.transaction === 'string' &&
    /^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(v.transaction) &&
    typeof v.blockNumber === 'string' &&
    /^(0|[1-9]\d{0,77})$/.test(v.blockNumber) &&
    typeof v.blockHash === 'string' &&
    /^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(v.blockHash) &&
    typeof v.finalizedBlockNumber === 'string' &&
    /^(0|[1-9]\d{0,77})$/.test(v.finalizedBlockNumber) &&
    typeof v.finalizedBlockHash === 'string' &&
    /^0x(?!0{64}$)[0-9a-fA-F]{64}$/.test(v.finalizedBlockHash) &&
    typeof v.authorizationKey === 'string' &&
    /^[0-9a-f]{64}$/.test(v.authorizationKey) &&
    typeof v.authorizationFingerprint === 'string' &&
    /^[0-9a-f]{64}$/.test(v.authorizationFingerprint) &&
    v.network === NETWORK &&
    typeof v.asset === 'string' &&
    v.asset.toLowerCase() === USDC.toLowerCase() &&
    typeof v.payer === 'string' &&
    typeof v.recipient === 'string' &&
    typeof v.amount === 'string' &&
    /^[1-9]\d{0,11}$/.test(v.amount) &&
    BigInt(v.finalizedBlockNumber) >= BigInt(v.blockNumber) &&
    v.sourceId === 'LOCAL_SIMULATION_ONLY'
  )
}

/**
 * Connects the read-only chain observer to durable local review evidence.
 * The service accepts no HTTP request and cannot change payment phases, receipts,
 * analytics, or evidence_kind. Production confirmation remains DB-trigger-blocked.
 */
export async function reviewUnknownSettlement(
  store: PaymentStore,
  merchantId: string,
  attemptId: string,
  transactionHash: string,
  observe: (
    expected: SettlementExpectation,
    transactionHash: string,
  ) => Promise<unknown>,
  clock: TrustedClock,
) {
  if (
    !/^[a-f0-9-]{36}$/.test(attemptId) ||
    !/^[a-f0-9-]{36}$/.test(merchantId) ||
    !/^0x[0-9a-fA-F]{64}$/.test(transactionHash)
  )
    throw new GatewayError(422, 'settlement_review_input_invalid')
  const attempt = await store.db
    .prepare(
      `SELECT id,merchant_id,resource_id,phase,evidence_kind,authorization_key,
        authorization_fingerprint,buyer_address,recipient,amount_atomic,asset,network
       FROM payment_attempts WHERE id=? AND merchant_id=?`,
    )
    .bind(attemptId, merchantId)
    .first<{
      id: string
      merchant_id: string
      resource_id: string
      phase: string
      evidence_kind: string
      authorization_key: string | null
      authorization_fingerprint: string | null
      buyer_address: string | null
      recipient: string
      amount_atomic: string
      asset: string
      network: string
    }>()
  if (
    !attempt ||
    attempt.phase !== 'settlement_unknown' ||
    attempt.evidence_kind !== 'local_simulation' ||
    !attempt.authorization_key ||
    !attempt.authorization_fingerprint ||
    !attempt.buyer_address ||
    attempt.network !== NETWORK ||
    attempt.asset.toLowerCase() !== USDC.toLowerCase()
  )
    throw new GatewayError(409, 'attempt_not_reviewable')

  const expected: SettlementExpectation = {
    authorizationKey: attempt.authorization_key,
    authorizationFingerprint: attempt.authorization_fingerprint,
    payer: attempt.buyer_address,
    recipient: attempt.recipient,
    amount: attempt.amount_atomic,
    asset: attempt.asset,
    network: attempt.network,
  }
  const observed = await observe(expected, transactionHash)
  boundedJson(JSON.stringify(observed), 8192, 256)
  if (
    !validObservation(observed) ||
    observed.transaction.toLowerCase() !== transactionHash.toLowerCase() ||
    observed.authorizationKey !== attempt.authorization_key ||
    observed.authorizationFingerprint !== attempt.authorization_fingerprint ||
    observed.payer.toLowerCase() !== attempt.buyer_address.toLowerCase() ||
    observed.recipient.toLowerCase() !== attempt.recipient.toLowerCase() ||
    observed.amount !== attempt.amount_atomic
  )
    throw new GatewayError(503, 'settlement_review_mismatch')

  const { sourceId, ...canonicalObservation } = observed
  const evidenceJson = canonical({
    ...canonicalObservation,
    provenance: 'LOCAL SIMULATION ONLY',
  })
  const now = await clockTime(clock)
  const entryId = crypto.randomUUID()
  const insert = await store.db
    .prepare(
      `INSERT INTO settlement_evidence_observations (
        id,attempt_id,merchant_id,resource_id,authorization_key,
        authorization_fingerprint,network,asset,payer_address,recipient_address,
        amount_atomic,transaction_hash,provenance,source_id,observed_at,outcome,evidence_json
      )
      SELECT ?,a.id,a.merchant_id,a.resource_id,a.authorization_key,
        a.authorization_fingerprint,a.network,a.asset,a.buyer_address,a.recipient,
        a.amount_atomic,?, 'local_simulation', ?, ?,
        CASE WHEN EXISTS (
          SELECT 1 FROM settlement_evidence_observations prior
          WHERE prior.attempt_id=a.id AND prior.outcome='conflict'
             OR (prior.attempt_id=a.id AND prior.outcome='rpc_observation_only'
                 AND (lower(prior.transaction_hash)!=lower(?) OR prior.evidence_json!=?))
        ) THEN 'conflict' ELSE 'rpc_observation_only' END,
        ?
      FROM payment_attempts a
      WHERE a.id=? AND a.merchant_id=? AND a.resource_id=?
        AND a.phase='settlement_unknown' AND a.evidence_kind='local_simulation'
        AND a.authorization_key=? AND a.authorization_fingerprint=?
        AND NOT EXISTS (
          SELECT 1 FROM settlement_evidence_observations same
          WHERE same.attempt_id=a.id AND lower(same.transaction_hash)=lower(?)
            AND same.source_id=? AND same.evidence_json=?
        )`,
    )
    .bind(
      entryId,
      transactionHash.toLowerCase(),
      sourceId,
      now,
      transactionHash,
      evidenceJson,
      evidenceJson,
      attempt.id,
      merchantId,
      attempt.resource_id,
      attempt.authorization_key,
      attempt.authorization_fingerprint,
      transactionHash,
      sourceId,
      evidenceJson,
    )
    .run()

  const current = await store.db
    .prepare(
      `SELECT id, outcome, transaction_hash, observed_at,
        CASE WHEN EXISTS (
          SELECT 1 FROM settlement_evidence_observations c
          WHERE c.attempt_id=? AND c.outcome='conflict'
        ) THEN 'conflict' ELSE outcome END AS effective_outcome
       FROM settlement_evidence_observations
       WHERE attempt_id=? AND lower(transaction_hash)=lower(?)
         AND source_id=? AND evidence_json=?
       ORDER BY observed_at DESC,id DESC LIMIT 1`,
    )
    .bind(attempt.id, attempt.id, transactionHash, sourceId, evidenceJson)
    .first<{
      id: string
      outcome: string
      transaction_hash: string
      observed_at: number
      effective_outcome: string
    }>()
  if (!current || (insert.meta.changes !== 1 && !current))
    throw new GatewayError(409, 'settlement_review_raced')

  return {
    id: current.id,
    outcome: current.effective_outcome,
    transactionHash: current.transaction_hash,
    observedAt: current.observed_at,
    persisted: insert.meta.changes === 1,
    productionAdmitted: false as const,
    localSimulationOnly: true as const,
    receiptCreated: false as const,
    attemptPhaseChanged: false as const,
  }
}
