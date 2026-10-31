import {
  paymentPhases,
  type ReportSource,
  type ReportSummary,
  type Provenance,
  type PaymentPhase,
} from '../../shared/reporting'
import { requireSession } from '../sg03/auth'
import { hash, HttpError, json, type ApiConfig } from '../sg03/http'
const asset = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'
const attemptProvenance = `CASE WHEN a.evidence_kind = 'local_simulation' AND a.network = 'eip155:8453' AND lower(a.asset) = '${asset}' THEN 'local_simulation' ELSE 'unverified' END`
// A provenance flag alone is never sufficient for a Mainnet claim. Production admission is not implemented.
const receiptProvenance = `CASE WHEN p.evidence_kind = 'local_simulation' AND a.evidence_kind = 'local_simulation'
 AND p.network = 'eip155:8453' AND a.network = p.network AND lower(a.asset) = '${asset}'
 AND p.amount_atomic = a.amount_atomic AND lower(p.payout_address) = lower(a.recipient)
 AND lower(p.payer_address) = lower(a.buyer_address) AND p.authorization_key = a.authorization_key
 AND a.authorization_key IS NOT NULL AND p.config_version = a.config_version AND p.config_hash = a.config_hash
 AND p.block_number = 'LOCAL_SIMULATION_ONLY' AND a.phase IN ('settled','fulfilling','fulfilled','fulfillment_failed')
 THEN 'local_simulation' ELSE 'unverified' END`
interface Filters {
  start: number
  end: number
  from: string
  to: string
  source: ReportSource
  resourceId?: string
  phase?: string
  limit: number
  cursor?: [number, string]
  key: string
}
function date(value: string) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value))
    throw new HttpError(422, 'Dates must use YYYY-MM-DD in UTC')
  const ms = Date.parse(`${value}T00:00:00.000Z`)
  if (
    !Number.isFinite(ms) ||
    ms < 0 ||
    new Date(ms).toISOString().slice(0, 10) !== value
  )
    throw new HttpError(422, 'Invalid calendar date')
  return ms
}
async function filters(
  request: Request,
  config: ApiConfig,
  merchant: string,
  kind: string,
): Promise<Filters> {
  const q = new URL(request.url).searchParams
  const allowed = [
    'from',
    'to',
    'source',
    'resourceId',
    ...(kind === 'summary' ? [] : ['limit', 'cursor']),
    ...(kind === 'attempts' ? ['phase'] : []),
  ]
  for (const key of q.keys())
    if (!allowed.includes(key) || q.getAll(key).length !== 1)
      throw new HttpError(422, 'Unsupported or repeated reporting filter')
  const today = new Date().toISOString().slice(0, 10)
  const from =
      q.get('from') ??
      new Date(date(today) - 29 * 86400000).toISOString().slice(0, 10),
    to = q.get('to') ?? today
  const start = date(from),
    end = date(to) + 86400000
  if (
    start >= end ||
    end - start > 90 * 86400000 ||
    end > date(today) + 86400000
  )
    throw new HttpError(
      422,
      'Choose an ordered UTC date range of at most 90 days ending no later than today',
    )
  const source = q.get('source') ?? 'all'
  if (!['all', 'local_simulation', 'unverified', 'verified'].includes(source))
    throw new HttpError(422, 'Invalid record source')
  const resourceId = q.get('resourceId') ?? undefined
  if (resourceId) {
    if (!/^[a-f0-9-]{36}$/.test(resourceId))
      throw new HttpError(422, 'Invalid resource filter')
    const own = await config.db
      .prepare('SELECT id FROM api_resources WHERE id = ? AND merchant_id = ?')
      .bind(resourceId, merchant)
      .first()
    if (!own) throw new HttpError(404, 'Resource not found')
  }
  const phase = q.get('phase') ?? undefined
  if (phase && !paymentPhases.includes(phase as PaymentPhase))
    throw new HttpError(422, 'Invalid payment phase')
  const limitText = q.get('limit') ?? '20'
  if (!/^(?:[1-9]|[1-4]\d|50)$/.test(limitText))
    throw new HttpError(422, 'Limit must be an integer from 1 to 50')
  const key = await hash(
    JSON.stringify([merchant, kind, from, to, source, resourceId, phase]),
  )
  let cursor: [number, string] | undefined
  const encoded = q.get('cursor')
  if (encoded) {
    try {
      if (encoded.length > 512 || !/^[a-zA-Z0-9_-]+$/.test(encoded))
        throw Error('invalid')
      const item = JSON.parse(
        atob(encoded.replaceAll('-', '+').replaceAll('_', '/')),
      ) as unknown[]
      if (
        !Array.isArray(item) ||
        item.length !== 3 ||
        item[2] !== key ||
        !Number.isSafeInteger(item[0]) ||
        Number(item[0]) < start ||
        Number(item[0]) >= end ||
        typeof item[1] !== 'string' ||
        !/^[a-zA-Z0-9_-]{1,128}$/.test(item[1])
      )
        throw Error('invalid')
      cursor = [Number(item[0]), item[1]]
    } catch {
      throw new HttpError(422, 'Invalid cursor for these reporting filters')
    }
  }
  return {
    start,
    end,
    from,
    to,
    source: source as ReportSource,
    resourceId,
    phase,
    limit: Number(limitText),
    cursor,
    key,
  }
}
function where(f: Filters, merchant: string, receipt: boolean) {
  const t = receipt ? 'p' : 'a'
  let sql = `a.merchant_id = ? AND r.merchant_id = a.merchant_id AND ${t}.created_at >= ? AND ${t}.created_at < ?`
  const values: (string | number)[] = [merchant, f.start, f.end]
  if (f.resourceId) {
    sql += ' AND a.resource_id = ?'
    values.push(f.resourceId)
  }
  if (f.phase) {
    sql += ' AND a.phase = ?'
    values.push(f.phase)
  }
  if (f.source === 'verified') sql += ' AND 0 = 1'
  else if (f.source !== 'all') {
    sql += ` AND (${receipt ? receiptProvenance : attemptProvenance}) = ?`
    values.push(f.source)
  }
  return { sql, values }
}
function safeCount(value: unknown) {
  if (!Number.isSafeInteger(value) || Number(value) < 0)
    throw new Error('report count overflow')
  return Number(value)
}
export async function reporting(
  request: Request,
  config: ApiConfig,
  kind: string,
) {
  const merchant = await requireSession(request, config)
  if (request.method !== 'GET')
    throw new HttpError(405, 'Reporting supports GET only')
  const f = await filters(request, config, merchant.merchant_id, kind)
  const db = config.db
  try {
    if (kind === 'summary') {
      const a = where(f, merchant.merchant_id, false),
        p = where(f, merchant.merchant_id, true)
      const [attempts, receipts] = await db.batch<Record<string, unknown>>([
        db
          .prepare(
            `SELECT a.phase, ${attemptProvenance} AS provenance, COUNT(*) AS count FROM payment_attempts a JOIN api_resources r ON r.id = a.resource_id WHERE ${a.sql} GROUP BY a.phase, provenance`,
          )
          .bind(...a.values),
        db
          .prepare(
            `WITH owned AS (SELECT p.amount_atomic, ${receiptProvenance} AS provenance FROM payment_receipts p JOIN payment_attempts a ON a.id = p.attempt_id JOIN api_resources r ON r.id = a.resource_id WHERE ${p.sql}) SELECT provenance, COUNT(*) AS count, CAST(SUM(CASE WHEN provenance = 'local_simulation' THEN CAST(amount_atomic AS INTEGER) ELSE 0 END) AS TEXT) AS total FROM owned GROUP BY provenance`,
          )
          .bind(...p.values),
      ])
      const result: ReportSummary = {
        window: { from: f.from, to: f.to },
        verified: {
          available: false,
          settlements: null,
          amountAtomic: null,
          reason:
            'Public payments are disabled. No approved production confirmation reader exists; provenance labels alone are not Mainnet proof.',
        },
        attempts: { total: 0, localSimulation: 0, unverified: 0, byPhase: {} },
        receipts: {
          localSimulation: 0,
          localSimulationAmountAtomic: '0',
          unverified: 0,
        },
      }
      for (const row of attempts.results) {
        const count = safeCount(row.count),
          phase = row.phase as PaymentPhase
        result.attempts.total += count
        result.attempts.byPhase[phase] =
          (result.attempts.byPhase[phase] ?? 0) + count
        if (row.provenance === 'local_simulation')
          result.attempts.localSimulation += count
        else result.attempts.unverified += count
      }
      for (const row of receipts.results) {
        if (row.provenance === 'local_simulation') {
          result.receipts.localSimulation = safeCount(row.count)
          if (typeof row.total !== 'string' || !/^\d{1,19}$/.test(row.total))
            throw Error('invalid aggregate')
          result.receipts.localSimulationAmountAtomic = BigInt(
            row.total,
          ).toString()
        } else result.receipts.unverified += safeCount(row.count)
      }
      safeCount(result.attempts.total)
      return json(result)
    }
    const receipt = kind === 'receipts',
      t = receipt ? 'p' : 'a',
      w = where(f, merchant.merchant_id, receipt)
    if (f.cursor) {
      w.sql += ` AND (${t}.created_at < ? OR (${t}.created_at = ? AND ${t}.id < ?))`
      w.values.push(f.cursor[0], f.cursor[0], f.cursor[1])
    }
    const fields = receipt
      ? `p.id, a.id AS attempt_id, p.created_at, a.resource_id, r.name AS resource_name, a.phase, a.amount_atomic AS requested_amount, p.amount_atomic, p.transaction_hash, ${receiptProvenance} AS provenance`
      : `a.id, a.resource_id, r.name AS resource_name, a.phase, a.amount_atomic AS requested_amount, a.created_at, a.updated_at, ${attemptProvenance} AS provenance`
    const joins = receipt
      ? 'payment_receipts p JOIN payment_attempts a ON a.id = p.attempt_id'
      : 'payment_attempts a'
    const rows = await db
      .prepare(
        `SELECT ${fields} FROM ${joins} JOIN api_resources r ON r.id = a.resource_id WHERE ${w.sql} ORDER BY ${t}.created_at DESC, ${t}.id DESC LIMIT ?`,
      )
      .bind(...w.values, f.limit + 1)
      .all<Record<string, unknown>>()
    const page = rows.results.slice(0, f.limit)
    const items = page.map((row) => ({
      id: row.id,
      resourceId: row.resource_id,
      resourceName: row.resource_name,
      phase: row.phase,
      requestedAmountAtomic: row.requested_amount,
      provenance: row.provenance as Provenance,
      createdAt: row.created_at,
      ...(receipt
        ? {
            attemptId: row.attempt_id,
            amountAtomic:
              row.provenance === 'local_simulation' ? row.amount_atomic : null,
            transactionReference:
              row.provenance === 'local_simulation'
                ? row.transaction_hash
                : null,
          }
        : { updatedAt: row.updated_at }),
    }))
    const last = page.at(-1)
    const nextCursor =
      rows.results.length > f.limit && last
        ? btoa(JSON.stringify([last.created_at, last.id, f.key]))
            .replaceAll('+', '-')
            .replaceAll('/', '_')
            .replaceAll('=', '')
        : null
    return json({ items, nextCursor })
  } catch {
    throw new HttpError(
      503,
      'Reporting is unavailable. Try a shorter date range or retry later.',
    )
  }
}
