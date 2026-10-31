import type { PaymentRequirements, SettleResponse } from '@x402/core/types'
import { GatewayError } from './bounds'
import { clockTime, type TrustedClock } from './clock'
import { NETWORK, USDC, type Snapshot } from './registry'
export type Phase =
  | 'created'
  | 'rejected'
  | 'verifying'
  | 'verified'
  | 'settlement_pending'
  | 'settlement_unknown'
  | 'settled'
  | 'failed'
  | 'fulfilling'
  | 'fulfilled'
  | 'fulfillment_failed'
  | 'legacy_unreconciled'
export interface Attempt {
  id: string
  asset: string
  recipient: string
  merchant_id: string
  resource_id: string
  phase: Phase
  amount_atomic: string
  request_hash: string
  url_hash: string
  requirements_json: string
  snapshot_hash: string
  config_revision: number
  binding_generation: number
  config_version: string
  config_hash: string
  authorization_key: string | null
  authorization_fingerprint: string | null
  buyer_address: string | null
  expires_at: number
  operation_deadline: number | null
}
const status = (phase: Phase) =>
  phase === 'settled' ||
  phase === 'fulfilling' ||
  phase === 'fulfilled' ||
  phase === 'fulfillment_failed'
    ? 'settled'
    : phase === 'failed'
      ? 'failed'
      : phase === 'rejected'
        ? 'rejected'
        : phase === 'created'
          ? 'created'
          : 'pending'
export class PaymentStore {
  constructor(
    public db: D1Database,
    public clock: TrustedClock,
  ) {}
  get(id: string) {
    return this.db
      .prepare('SELECT * FROM payment_attempts WHERE id = ?')
      .bind(id)
      .first<Attempt>()
  }
  async create(
    id: string,
    s: Snapshot,
    requestHash: string,
    urlHash: string,
    required: PaymentRequirements,
  ) {
    const now = await clockTime(this.clock)
    await this.db
      .prepare(
        `INSERT INTO payment_attempts (id,merchant_id,resource_id,idempotency_key,network,amount_atomic,status,phase,created_at,updated_at,asset,recipient,request_hash,url_hash,requirements_json,snapshot_hash,config_revision,binding_generation,config_version,config_hash,expires_at,evidence_kind) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      )
      .bind(
        id,
        s.merchantId,
        s.id,
        id,
        NETWORK,
        s.resource.priceAtomic,
        'created',
        'created',
        now,
        now,
        USDC,
        s.resource.payoutAddress,
        requestHash,
        urlHash,
        JSON.stringify(required),
        s.hash,
        s.revision,
        s.binding.generation,
        s.binding.registry_version,
        s.binding.config_hash,
        now + 60000,
        'local_simulation',
      )
      .run()
  }
  async claim(
    a: Attempt,
    identity: string,
    fingerprint: string,
    payer: string,
  ) {
    try {
      const now = await clockTime(this.clock)
      const r = await this.db
        .prepare(
          `UPDATE payment_attempts SET authorization_key = ?, authorization_fingerprint = ?, buyer_address = ?, phase = 'verifying', status = 'pending', updated_at = ?, operation_deadline = ? WHERE id = ? AND phase = 'created' AND expires_at > ?`,
        )
        .bind(identity, fingerprint, payer, now, now + 10000, a.id, now)
        .run()
      return r.meta.changes === 1
    } catch (error) {
      const duplicate = await this.db
        .prepare(
          'SELECT id FROM payment_attempts WHERE authorization_key = ? OR authorization_fingerprint = ?',
        )
        .bind(identity, fingerprint)
        .first<{ id: string }>()
      if (!duplicate) throw error
      await this.advance(a.id, 'created', 'rejected', 'authorization_replay')
      throw new GatewayError(409, 'authorization_already_claimed')
    }
  }
  async advance(
    id: string,
    from: Phase,
    to: Phase,
    code: string | null = null,
    s?: Snapshot,
  ) {
    const now = await clockTime(this.clock)
    let sql =
      'UPDATE payment_attempts SET phase = ?, status = ?, failure_code = ?, updated_at = ?, operation_deadline = ? WHERE id = ? AND phase = ?'
    const values: (string | number | null)[] = [
      to,
      status(to),
      code,
      now,
      now + 10000,
      id,
      from,
    ]
    if (s) {
      sql += ` AND EXISTS (SELECT 1 FROM api_resources r JOIN merchants m ON m.id = r.merchant_id JOIN resource_registry_bindings b ON b.resource_id = r.id WHERE r.id = payment_attempts.resource_id AND r.merchant_id = ? AND m.wallet_address = ? AND r.enabled = 1 AND r.payment_revision = ? AND b.generation = ? AND b.source = 'local_simulation')`
      values.push(s.merchantId, s.owner, s.revision, s.binding.generation)
    }
    if (to === 'fulfilled')
      sql += ` AND EXISTS (SELECT 1 FROM payment_receipts p WHERE p.attempt_id = payment_attempts.id AND p.evidence_kind = 'local_simulation')`
    const result = await this.db
      .prepare(sql)
      .bind(...values)
      .run()
    return result.meta.changes === 1
  }
  async settle(
    a: Attempt,
    result: SettleResponse,
    from: 'settlement_pending' | 'settlement_unknown',
  ) {
    const now = await clockTime(this.clock)
    const rows = await this.db.batch([
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase = 'settled', status = 'settled', updated_at = ?, failure_code = NULL WHERE id = ? AND phase = ? AND authorization_key = ?`,
        )
        .bind(now, a.id, from, a.authorization_key),
      this.db
        .prepare(
          `INSERT INTO payment_receipts (id,attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,created_at,evidence_kind,authorization_key,config_version,config_hash,settlement_json) SELECT ?,id,?,network,amount_atomic,buyer_address,recipient,?,?,?,?,?,?,? FROM payment_attempts WHERE id = ? AND phase = 'settled' AND NOT EXISTS (SELECT 1 FROM payment_receipts WHERE attempt_id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          result.transaction,
          'LOCAL_SIMULATION_ONLY',
          now,
          'local_simulation',
          a.authorization_key,
          a.config_version,
          a.config_hash,
          JSON.stringify({ ...result, extra: { localSimulationOnly: true } }),
          a.id,
          a.id,
        ),
      this.db
        .prepare(
          `INSERT INTO analytics_events (id,merchant_id,resource_id,event_type,occurred_at,attempt_id,evidence_kind) SELECT ?,merchant_id,resource_id,?,?,id,? FROM payment_attempts WHERE id = ? AND phase = 'settled' AND NOT EXISTS (SELECT 1 FROM analytics_events WHERE attempt_id = ? AND event_type = 'payment_settled')`,
        )
        .bind(
          crypto.randomUUID(),
          'payment_settled',
          now,
          'local_simulation',
          a.id,
          a.id,
        ),
    ])
    return rows[0].meta.changes === 1 && rows[1].meta.changes === 1
  }
  async receipt(id: string) {
    return this.db
      .prepare(
        `SELECT settlement_json FROM payment_receipts WHERE attempt_id = ? AND evidence_kind = 'local_simulation'`,
      )
      .bind(id)
      .first<{ settlement_json: string }>()
  }
  async recover() {
    const now = await clockTime(this.clock)
    const results = await this.db.batch([
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase = 'settlement_unknown', failure_code = 'settlement_interrupted', updated_at = ? WHERE phase = 'settlement_pending' AND operation_deadline < ?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase = 'failed', status = 'failed', failure_code = 'interrupted_before_settlement', updated_at = ? WHERE phase IN ('verifying','verified') AND operation_deadline < ?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase = 'fulfillment_failed', failure_code = 'fulfillment_interrupted', updated_at = ? WHERE phase = 'fulfilling' AND operation_deadline < ?`,
        )
        .bind(now, now),
      this.db
        .prepare(
          `UPDATE payment_attempts SET phase = 'failed', status = 'failed', failure_code = 'challenge_expired', updated_at = ? WHERE phase = 'created' AND expires_at < ?`,
        )
        .bind(now, now),
    ])
    return results.map((r) => r.meta.changes)
  }
}
