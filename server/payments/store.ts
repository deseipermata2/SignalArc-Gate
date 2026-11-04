import type { PaymentDatabase } from './config'
import { canonical } from '../sg05/bounds'
import type { Attempt } from '../sg05/store'
import type { PaymentRequirements } from '@x402/core/types'
import { NETWORK, USDC } from '../sg05/registry'
import { hash } from '../sg03/http'
import {
  type ActiveResource,
  type Clock,
  type Realm,
  unavailable,
} from './authority'

export interface ActivationAttempt extends Attempt {
  updated_at: number
  activation_realm: Realm
  authorization_nonce: string | null
  delivery_claims: number
}
export class ActivationStore {
  constructor(
    public db: PaymentDatabase,
    public realm: Realm,
    public clock: Clock,
  ) {}
  get(id: string) {
    return this.db
      .prepare(
        'SELECT * FROM payment_attempts WHERE id=? AND activation_realm=?',
      )
      .bind(id, this.realm)
      .first<ActivationAttempt>()
  }
  async create(
    id: string,
    s: ActiveResource,
    ticket: string,
    url: string,
    required: PaymentRequirements,
  ) {
    const now = await this.clock(),
      m = s.manifest
    await this.db
      .prepare(
        `INSERT INTO payment_attempts(id,merchant_id,resource_id,idempotency_key,network,amount_atomic,status,phase,created_at,updated_at,asset,recipient,request_hash,url_hash,requirements_json,snapshot_hash,config_revision,binding_generation,config_version,config_hash,expires_at,evidence_kind,activation_realm) VALUES(?,?,?,?,?,?,'created','created',?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        m.merchant_id,
        m.resource_id,
        id,
        NETWORK,
        m.amount_atomic,
        now,
        now,
        USDC,
        m.recipient,
        await hash(ticket),
        await hash(url),
        canonical(required),
        s.hash,
        m.resource_revision,
        m.binding_generation,
        m.registry_version,
        m.config_hash,
        now + 60000,
        this.realm === 'operator_rpc'
          ? 'legacy_unconfirmed'
          : 'local_simulation',
        this.realm,
      )
      .run()
  }
  async claim(
    a: ActivationAttempt,
    key: string,
    fingerprint: string,
    payer: string,
    nonce: string,
  ) {
    try {
      const r = await this.db
        .prepare(
          `UPDATE payment_attempts SET phase='verifying',status='pending',authorization_key=?,authorization_fingerprint=?,buyer_address=?,authorization_nonce=?,operation_deadline=?,updated_at=? WHERE id=? AND phase='created' AND activation_realm=? AND expires_at>? AND updated_at<=?`,
        )
        .bind(
          key,
          fingerprint,
          payer,
          nonce,
          (await this.clock()) + 15000,
          await this.clock(),
          a.id,
          this.realm,
          await this.clock(),
          await this.clock(),
        )
        .run()
      return r.meta.changes === 1
    } catch (error) {
      if (String(error).includes('UNIQUE')) return false
      throw error
    }
  }
  async advance(
    id: string,
    from: string,
    to: string,
    code: string | null = null,
  ) {
    const status = [
      'settled',
      'fulfilling',
      'fulfilled',
      'fulfillment_failed',
    ].includes(to)
      ? 'settled'
      : to === 'failed'
        ? 'failed'
        : to === 'rejected'
          ? 'rejected'
          : 'pending'
    const now = await this.clock()
    const lease = ['verified', 'settlement_pending'].includes(to)
      ? ' AND operation_deadline>=? AND expires_at>? AND updated_at<=?'
      : ''
    return (
      (
        await this.db
          .prepare(
            'UPDATE payment_attempts SET phase=?,status=?,failure_code=?,updated_at=?,operation_deadline=? WHERE id=? AND phase=? AND activation_realm=?' +
              lease,
          )
          .bind(
            to,
            status,
            code,
            now,
            now + 20000,
            id,
            from,
            this.realm,
            ...(['verified', 'settlement_pending'].includes(to)
              ? [now, now, now]
              : []),
          )
          .run()
      ).meta.changes === 1
    )
  }
  async submissionPermit(a: ActivationAttempt) {
    const now = await this.clock()
    const r = await this.db
      .prepare(
        `UPDATE payment_attempts AS a SET submission_started_at=?,updated_at=? WHERE a.id=? AND a.activation_realm=? AND a.phase='settlement_pending' AND a.submission_started_at IS NULL AND a.operation_deadline>=? AND a.expires_at>? AND a.updated_at<=? AND EXISTS(SELECT 1 FROM api_resources r JOIN payment_manifests m ON m.resource_id=r.id JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=a.resource_id AND r.merchant_id=a.merchant_id AND r.enabled=1 AND r.payment_revision=a.config_revision AND b.generation=a.binding_generation AND m.revoked_at IS NULL AND m.expires_at>? AND m.realm=a.activation_realm) AND NOT EXISTS(SELECT 1 FROM payment_quarantine q WHERE (q.scope='registry' AND q.scope_id=a.resource_id) OR(q.scope='settlement' AND q.scope_id=a.id))`,
      )
      .bind(now, now, a.id, this.realm, now, now, now, now)
      .run()
    return r.meta.changes === 1
  }
  async report(a: ActivationAttempt, transaction: string | null) {
    await this.db
      .prepare(
        `INSERT INTO payment_submission_reports(attempt_id,realm,authorization_key,authorization_fingerprint,transaction_hash,disposition,reported_at) SELECT ?,?,?,?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_submission_reports WHERE attempt_id=?)`,
      )
      .bind(
        a.id,
        this.realm,
        a.authorization_key,
        a.authorization_fingerprint,
        transaction,
        transaction ? 'reported_settled' : 'unknown',
        await this.clock(),
        a.id,
      )
      .run()
  }
  receipt(id: string) {
    return this.db
      .prepare('SELECT * FROM payment_receipts WHERE attempt_id=?')
      .bind(id)
      .first<{
        transaction_hash: string
        settlement_json: string
        evidence_kind: string
      }>()
  }
  async finalize(
    a: ActivationAttempt,
    checkpoint: string,
    proof: {
      transaction: string
      blockNumber: string
      payer: string
      amount: string
    },
  ) {
    const now = await this.clock(),
      kind =
        this.realm === 'operator_rpc' ? 'confirmed_onchain' : 'local_simulation'
    const settlement = {
      success: true,
      transaction: proof.transaction,
      network: NETWORK,
      payer: proof.payer,
      amount: proof.amount,
      extra: {
        evidence:
          this.realm === 'operator_rpc'
            ? 'canonical_finalized_receipt'
            : 'LOCAL_SIMULATION_ONLY',
      },
    }
    const rows = await this.db.batch([
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase='settled',status='settled',evidence_kind=?,updated_at=? WHERE id=? AND activation_realm=? AND phase IN ('settlement_pending','settlement_unknown') AND authorization_key=? AND authorization_fingerprint=? AND NOT EXISTS(SELECT 1 FROM payment_receipts p WHERE p.attempt_id=payment_attempts.id) AND EXISTS(SELECT 1 FROM payment_chain_evidence e WHERE e.id=? AND e.scope='settlement' AND e.scope_id=payment_attempts.id AND e.realm=payment_attempts.activation_realm) AND NOT EXISTS(SELECT 1 FROM payment_quarantine q WHERE q.scope='settlement' AND q.scope_id=payment_attempts.id)`,
        )
        .bind(
          kind,
          now,
          a.id,
          this.realm,
          a.authorization_key,
          a.authorization_fingerprint,
          checkpoint,
        ),
      this.db
        .prepare(
          `INSERT INTO payment_receipts(id,attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,created_at,evidence_kind,authorization_key,config_version,config_hash,settlement_json) SELECT ?,id,?,network,amount_atomic,buyer_address,recipient,?,?,?,authorization_key,config_version,config_hash,? FROM payment_attempts WHERE changes()=1 AND id=? AND phase='settled'`,
        )
        .bind(
          crypto.randomUUID(),
          proof.transaction,
          proof.blockNumber,
          now,
          kind,
          canonical(settlement),
          a.id,
        ),
      this.db
        .prepare(
          `INSERT INTO analytics_events(id,merchant_id,resource_id,event_type,occurred_at,attempt_id,evidence_kind) SELECT ?,merchant_id,resource_id,'payment_settled',?,id,? FROM payment_attempts WHERE changes()=1 AND id=? AND phase='settled'`,
        )
        .bind(crypto.randomUUID(), now, kind, a.id),
    ])
    if (rows[0].meta.changes !== 1) unavailable('settlement_admission_raced')
    return settlement
  }
  async fulfillment(a: ActivationAttempt, s: ActiveResource, finish = false) {
    const phase = finish ? 'fulfilled' : 'fulfilling',
      expected = finish
        ? "a.phase='fulfilling'"
        : "a.phase IN ('settled','fulfillment_failed') AND a.delivery_claims<3"
    const r = await this.db
      .prepare(
        `UPDATE payment_attempts AS a SET phase=?,delivery_claims=delivery_claims+?,updated_at=?,operation_deadline=? WHERE a.id=? AND a.activation_realm=? AND ${expected} AND a.delivery_claims=? ${finish ? 'AND a.operation_deadline>?' : ''} AND a.snapshot_hash=? AND EXISTS(SELECT 1 FROM payment_receipts p WHERE p.attempt_id=a.id AND p.evidence_kind=?) AND EXISTS(SELECT 1 FROM api_resources r JOIN payment_manifests m ON m.resource_id=r.id JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=a.resource_id AND r.merchant_id=a.merchant_id AND r.enabled=1 AND r.payment_revision=a.config_revision AND b.generation=a.binding_generation AND m.revoked_at IS NULL AND m.expires_at>? AND m.realm=a.activation_realm) AND NOT EXISTS(SELECT 1 FROM payment_quarantine q WHERE (q.scope='settlement' AND q.scope_id=a.id) OR(q.scope='registry' AND q.scope_id=a.resource_id))`,
      )
      .bind(
        phase,
        finish ? 0 : 1,
        await this.clock(),
        (await this.clock()) + 10000,
        a.id,
        this.realm,
        a.delivery_claims + (finish ? 1 : 0),
        ...(finish ? [await this.clock()] : []),
        s.hash,
        this.realm === 'operator_rpc'
          ? 'confirmed_onchain'
          : 'local_simulation',
        await this.clock(),
      )
      .run()
    return r.meta.changes === 1
  }
  async deliveryFailed(a: ActivationAttempt) {
    const r = await this.db
      .prepare(
        "UPDATE payment_attempts SET phase='fulfillment_failed',status='settled',failure_code='paid_delivery_unavailable',updated_at=? WHERE id=? AND activation_realm=? AND phase='fulfilling' AND delivery_claims=?",
      )
      .bind(await this.clock(), a.id, this.realm, a.delivery_claims + 1)
      .run()
    return r.meta.changes === 1
  }
  async recover(a: ActivationAttempt) {
    if (
      a.operation_deadline === null ||
      a.operation_deadline >= (await this.clock())
    )
      return
    if (a.phase === 'settlement_pending')
      await this.advance(
        a.id,
        a.phase,
        'settlement_unknown',
        'submission_interrupted',
      )
    if (['verifying', 'verified'].includes(a.phase))
      await this.advance(
        a.id,
        a.phase,
        'failed',
        'interrupted_before_submission',
      )
    if (a.phase === 'fulfilling')
      await this.advance(
        a.id,
        a.phase,
        'fulfillment_failed',
        'delivery_interrupted',
      )
  }
}
