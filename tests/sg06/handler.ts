import { readJson } from '../../server/sg03/http'
import { keccak256, toHex } from 'viem'
type Env = {
  APP_ENV: string
  APP_ORIGIN: string
  SG06_LOCAL_ONLY?: string
  SIGNALARC_DB: D1Database
}
// Test project only. Native D1 uses its binding, not global fetch.
globalThis.fetch = async () => {
  throw Error('SG06 fixture blocks network egress')
}
export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Env
}) {
  const url = new URL(request.url)
  if (
    env.APP_ENV !== 'local' ||
    env.SG06_LOCAL_ONLY !== 'yes' ||
    url.origin !== env.APP_ORIGIN ||
    url.hostname !== '127.0.0.1'
  )
    return new Response('Local fixture disabled', { status: 404 })
  const db = env.SIGNALARC_DB
  if ((await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db')
    return new Response('Local D1 required', { status: 404 })
  if (url.pathname === '/sg06/egress') {
    let blocked = false
    try {
      await fetch('https://example.invalid')
    } catch {
      blocked = true
    }
    return Response.json({ blocked })
  }
  if (
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes'
  )
    return new Response('Local control required', { status: 403 })
  const body = (await readJson(request)) as {
    action: string
    resourceId: string
    mode?: string
  }
  if (body.action === 'fault') {
    await db.prepare('DROP TABLE IF EXISTS sg06_saved_receipts').run()
    if (body.mode === 'on')
      await db
        .prepare('ALTER TABLE payment_receipts RENAME TO sg06_saved_receipts')
        .run()
    return Response.json({ changed: true })
  }
  if (body.action === 'restore') {
    await db
      .prepare('ALTER TABLE sg06_saved_receipts RENAME TO payment_receipts')
      .run()
    return Response.json({ changed: true })
  }
  if (body.action === 'seed') {
    const r = await db
      .prepare(
        'SELECT r.*,m.wallet_address FROM api_resources r JOIN merchants m ON m.id = r.merchant_id WHERE r.id = ?',
      )
      .bind(body.resourceId)
      .first<Record<string, unknown>>()
    if (!r) throw Error('Local resource required')
    const now = Date.now() - 60000,
      hash = '0x' + '11'.repeat(32),
      payer = String(r.wallet_address)
    const rows: D1PreparedStatement[] = []
    const ids: string[] = []
    const phases = [
      'fulfilled',
      'fulfillment_failed',
      'settlement_unknown',
      'settlement_pending',
      'failed',
      'rejected',
      'created',
      'legacy_unreconciled',
    ]
    for (let i = 0; i < phases.length; i++) {
      const id = crypto.randomUUID()
      ids.push(id)
      const phase = phases[i],
        legacy = phase === 'legacy_unreconciled',
        amount = i === 0 ? '999999999999' : i === 1 ? '1' : '1000'
      const auth = keccak256(toHex('LOCAL SIMULATION ONLY ' + id)).slice(2)
      rows.push(
        db
          .prepare(
            `INSERT INTO payment_attempts (id,merchant_id,resource_id,idempotency_key,network,amount_atomic,status,phase,created_at,updated_at,evidence_kind,asset,recipient,buyer_address,authorization_key,config_version,config_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
          )
          .bind(
            id,
            r.merchant_id,
            body.resourceId,
            id,
            'eip155:8453',
            amount,
            'created',
            legacy ? 'legacy_unreconciled' : 'created',
            now,
            now,
            legacy ? 'legacy_unconfirmed' : 'local_simulation',
            '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
            r.payout_address,
            payer,
            legacy ? null : auth,
            '1',
            hash,
          ),
      )
      const stages =
        phase === 'fulfilled'
          ? [
              'verifying',
              'verified',
              'settlement_pending',
              'settled',
              'fulfilling',
              'fulfilled',
            ]
          : phase === 'fulfillment_failed'
            ? [
                'verifying',
                'verified',
                'settlement_pending',
                'settled',
                'fulfilling',
                'fulfillment_failed',
              ]
            : phase === 'settlement_unknown'
              ? [
                  'verifying',
                  'verified',
                  'settlement_pending',
                  'settlement_unknown',
                ]
              : phase === 'settlement_pending'
                ? ['verifying', 'verified', 'settlement_pending']
                : phase === 'failed'
                  ? ['verifying', 'failed']
                  : phase === 'rejected'
                    ? ['rejected']
                    : []
      for (const stage of stages)
        rows.push(
          db
            .prepare('UPDATE payment_attempts SET phase = ? WHERE id = ?')
            .bind(stage, id),
        )
      if (i < 2 || legacy) {
        rows.push(
          db
            .prepare(
              'INSERT INTO payment_receipts (id,attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,created_at,evidence_kind,authorization_key,config_version,config_hash) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)',
            )
            .bind(
              crypto.randomUUID(),
              id,
              keccak256(toHex('LOCAL TEST RECEIPT ' + id)),
              'eip155:8453',
              amount,
              payer,
              r.payout_address,
              'LOCAL_SIMULATION_ONLY',
              now,
              legacy ? 'legacy_unconfirmed' : 'local_simulation',
              legacy ? null : auth,
              '1',
              hash,
            ),
        )
        if (!legacy)
          rows.push(
            db
              .prepare(
                'INSERT INTO analytics_events (id,merchant_id,resource_id,event_type,occurred_at,attempt_id,evidence_kind) VALUES (?,?,?,?,?,?,?)',
              )
              .bind(
                crypto.randomUUID(),
                r.merchant_id,
                body.resourceId,
                'payment_settled',
                now,
                id,
                'local_simulation',
              ),
          )
      }
    }
    await db.batch(rows)
    return Response.json({ ids, localSimulationOnly: true })
  }
  if (body.action === 'duplicate') {
    const a = await db
      .prepare(
        "SELECT id FROM payment_attempts WHERE resource_id = ? AND phase = 'fulfilled'",
      )
      .bind(body.resourceId)
      .first<{ id: string }>()
    let rejected = false
    try {
      await db
        .prepare(
          'INSERT INTO payment_receipts (id,attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,created_at,evidence_kind) SELECT ?,attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,created_at,evidence_kind FROM payment_receipts WHERE attempt_id = ?',
        )
        .bind(crypto.randomUUID(), a!.id)
        .run()
    } catch {
      rejected = true
    }
    return Response.json({ rejected })
  }
  return new Response('Not found', { status: 404 })
}
