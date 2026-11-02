import {
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  type Hex,
} from 'viem'
import {
  createRegistryReview,
  type ReviewSource,
} from '../../server/sg07/admission'
import { registryAbi, type RegistryPolicy } from '../../server/sg07/registry'
import {
  resourceId,
  commitment,
  snapshot,
  type Snapshot,
  USDC,
} from '../../server/sg05/registry'
import { PaymentStore } from '../../server/sg05/store'
import { readJson } from '../../server/sg03/http'
import { resourceInput } from '../../shared/resources'

globalThis.fetch = async () => {
  throw Error('Registry review fixture forbids live egress')
}
const owner = '0x00000000000000000000000000000000000a11ce',
  other = '0x0000000000000000000000000000000000000b0b',
  zero = '0x0000000000000000000000000000000000000000'
const salt = '0x' + '11'.repeat(32),
  code = '0x60006000' as Hex,
  blockHash = '0x' + '22'.repeat(32)
const policy: RegistryPolicy = {
  chainId: 8453,
  asset: USDC,
  address: other,
  runtimeCodeHash: keccak256(code),
  finality: 'finalized',
  minConfirmations: 2,
  maxBlockAgeMs: 3600000,
}
const preparedPayments = new Map<
  string,
  { snapshot: Snapshot; attemptId: string }
>()
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
    env.REGISTRY_REVIEW_LOCAL_ONLY !== 'yes' ||
    url.origin !== env.APP_ORIGIN ||
    url.hostname !== '127.0.0.1' ||
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes' ||
    (await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db'
  )
    return new Response('Local review disabled', { status: 404 })
  const body = (await readJson(request)) as {
    action: string
    id: string
    mode?: string
    block?: number
    source?: string
  }
  // Fixed LOCAL SIMULATION epoch; host wall-clock skew is not fixture authority.
  let now = Date.parse('2026-11-02T00:00:00Z')
  const clock = async () => now
  if (body.action === 'seed') {
    const id = crypto.randomUUID(),
      m = crypto.randomUUID(),
      onchain = resourceId(owner, id),
      hash = commitment(onchain, 'https://api.example.com/data', 4096, salt)
    await db
      .prepare(
        'INSERT INTO merchants VALUES (?,?,?,?) ON CONFLICT(wallet_address) DO NOTHING',
      )
      .bind(m, owner, now, now)
      .run()
    const merchant = await db
      .prepare('SELECT id FROM merchants WHERE wallet_address=?')
      .bind(owner)
      .first<{ id: string }>()
    await db.batch([
      db
        .prepare(
          'INSERT INTO api_resources (id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          merchant!.id,
          'LOCAL SIMULATION ONLY',
          'https://api.example.com/data',
          '{"type":"json","maxBytes":4096,"redirects":"error"}',
          '1000',
          owner,
          'eip155:8453',
          1,
          now,
          now,
        ),
    ])
    if (body.mode !== 'missing')
      await db
        .prepare(
          'INSERT INTO resource_registry_bindings (resource_id,original_owner,onchain_resource_id,config_salt,config_hash,registry_version,source,checked_at) VALUES (?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          owner,
          onchain,
          salt,
          hash,
          '1',
          body.mode === 'unconfirmed' ? 'unconfirmed' : 'local_simulation',
          now,
        )
        .run()
    return Response.json({ id, localSimulationOnly: true })
  }
  const id = body.id
  if (body.action === 'inspect')
    return Response.json({
      resource: await db
        .prepare('SELECT * FROM api_resources WHERE id=?')
        .bind(id)
        .first(),
      binding: await db
        .prepare('SELECT * FROM resource_registry_bindings WHERE resource_id=?')
        .bind(id)
        .first(),
      journal: (
        await db
          .prepare(
            'SELECT * FROM registry_evidence_journal WHERE resource_id=? ORDER BY rowid',
          )
          .bind(id)
          .all()
      ).results,
      attempts: (
        await db
          .prepare('SELECT * FROM payment_attempts WHERE resource_id=?')
          .bind(id)
          .all()
      ).results,
      receipts: (
        await db.prepare('SELECT COUNT(*) AS n FROM payment_receipts').first()
      )?.n,
    })
  if (body.action === 'legacyFlag') {
    if (
      await db
        .prepare('SELECT name FROM local_migrations WHERE name=?')
        .bind('0005_sg07_persistent_quarantine.sql')
        .first()
    )
      return new Response('Legacy fixture only', { status: 403 })
    await db
      .prepare(
        'UPDATE resource_registry_bindings SET review_conflicted=1 WHERE resource_id=?',
      )
      .bind(id)
      .run()
    return Response.json({ legacyQuarantine: true })
  }
  if (body.action === 'recreate') {
    const old = await db
      .prepare('SELECT * FROM resource_registry_bindings WHERE resource_id=?')
      .bind(id)
      .first<Record<string, unknown>>()
    if (!old) return new Response('Binding required', { status: 404 })
    const original = String(old.original_owner)
    const price = body.mode === 'changed-config' ? '2000' : undefined
    const hash =
      body.mode === 'changed-config'
        ? commitment(
            resourceId(original, id),
            'https://api.example.com/changed',
            4096,
            salt,
          )
        : String(old.config_hash)
    const statements: D1PreparedStatement[] = []
    if (price)
      statements.push(
        db
          .prepare(
            'UPDATE api_resources SET price_atomic=?,upstream_url=? WHERE id=?',
          )
          .bind(price, 'https://api.example.com/changed', id),
      )
    if (body.mode === 'changed-owner')
      statements.push(
        db
          .prepare(
            'UPDATE merchants SET wallet_address=? WHERE id=(SELECT merchant_id FROM api_resources WHERE id=?)',
          )
          .bind('0x000000000000000000000000000000000000ca11', id),
      )
    statements.push(
      db
        .prepare('DELETE FROM resource_registry_bindings WHERE resource_id=?')
        .bind(id),
    )
    statements.push(
      db
        .prepare(
          'INSERT INTO resource_registry_bindings (resource_id,original_owner,onchain_resource_id,registry_address,config_salt,config_hash,registry_version,source,checked_at) VALUES (?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          original,
          resourceId(original, id),
          body.mode === 'changed-registry' ? owner : null,
          old.config_salt,
          hash,
          old.registry_version,
          body.mode === 'changed-registry' ? 'unconfirmed' : 'local_simulation',
          now,
        ),
    )
    if (body.mode === 'fault')
      await db
        .prepare(
          "CREATE TRIGGER sg07_recreate_fault AFTER INSERT ON resource_registry_bindings BEGIN SELECT RAISE(ABORT,'local_recreation_interruption'); END",
        )
        .run()
    try {
      await db.batch(statements)
      return Response.json({ recreated: true })
    } catch {
      return Response.json({ rolledBack: true }, { status: 503 })
    } finally {
      await db.prepare('DROP TRIGGER IF EXISTS sg07_recreate_fault').run()
    }
  }
  if (body.action === 'restoreSource') {
    let rejected = false
    try {
      await db
        .prepare(
          body.mode === 'source-only'
            ? "UPDATE resource_registry_bindings SET source='local_simulation' WHERE resource_id=?"
            : "UPDATE resource_registry_bindings SET source='local_simulation',review_conflicted=0 WHERE resource_id=?",
        )
        .bind(id)
        .run()
    } catch {
      rejected = true
    }
    return Response.json({ rejected })
  }
  if (body.action === 'staleAttempt') {
    const saved = preparedPayments.get(id)
    if (!saved)
      return new Response('Prepared attempt required', { status: 404 })
    const store = new PaymentStore(db, clock)
    return Response.json({
      settlementClaim: await store.advance(
        saved.attemptId,
        'verified',
        'settlement_pending',
        null,
        saved.snapshot,
      ),
      attempt: await store.get(saved.attemptId),
    })
  }
  if (body.action === 'dropFault') {
    await db.prepare('DROP TRIGGER IF EXISTS sg07_review_fault').run()
    return Response.json({ done: true })
  }
  if (body.action === 'rollbackCounters') {
    let rejected = 0
    try {
      await db
        .prepare(
          'UPDATE resource_registry_bindings SET generation=generation-1 WHERE resource_id=?',
        )
        .bind(id)
        .run()
    } catch {
      rejected++
    }
    try {
      await db
        .prepare(
          'UPDATE api_resources SET payment_revision=payment_revision-1 WHERE id=?',
        )
        .bind(id)
        .run()
    } catch {
      rejected++
    }
    return Response.json({ rejected })
  }
  if (body.action === 'immutable') {
    let rejected = false
    try {
      await db
        .prepare(
          "UPDATE registry_evidence_journal SET outcome='review_only' WHERE resource_id=?",
        )
        .bind(id)
        .run()
    } catch {
      rejected = true
    }
    return Response.json({ rejected })
  }
  if (body.action === 'forge') {
    let rejected = false
    try {
      await db
        .prepare(
          "UPDATE resource_registry_bindings SET source='onchain_confirmed',registry_address=?,block_number='100',block_hash=? WHERE resource_id=?",
        )
        .bind(other, blockHash, id)
        .run()
    } catch {
      rejected = true
    }
    return Response.json({ rejected })
  }
  if (body.action === 'crudForge') {
    let rejected = false
    try {
      resourceInput({
        name: 'x',
        upstreamUrl: 'https://api.example.com',
        priceAtomic: '1000',
        payoutAddress: owner,
        network: 'eip155:8453',
        enabled: true,
        responseConfig: { type: 'json', maxBytes: 4096, redirects: 'error' },
        source: 'onchain_confirmed',
      })
    } catch {
      rejected = true
    }
    return Response.json({ rejected })
  }
  if (body.action === 'payment') {
    const b = await db
      .prepare('SELECT * FROM resource_registry_bindings WHERE resource_id=?')
      .bind(id)
      .first<Record<string, unknown>>()
    const read = async () => ({
      id: String(b?.onchain_resource_id),
      owner,
      pendingOwner: null,
      payout: owner,
      priceAtomic: '1000',
      configHash: String(b?.config_hash),
      version: '1',
      enabled: true,
      observedAt: now,
      localSimulationOnly: true as const,
    })
    try {
      const s = await snapshot(db, id, read, clock),
        store = new PaymentStore(db, clock),
        attemptId = crypto.randomUUID()
      await store.create(attemptId, s, 'fixture_request', 'fixture_url', {
        scheme: 'exact',
        network: 'eip155:8453',
        asset: USDC,
        amount: '1000',
        payTo: owner,
        maxTimeoutSeconds: 60,
        extra: { paymentFlow: 'upfront' },
      })
      if (body.mode === 'prepare') {
        await store.advance(attemptId, 'created', 'verifying')
        await store.advance(attemptId, 'verifying', 'verified', null, s)
        preparedPayments.set(id, { snapshot: s, attemptId })
        return Response.json({ prepared: true, attemptId })
      }
      if (body.mode === 'invalidate') {
        await store.advance(attemptId, 'created', 'verifying')
        await store.advance(attemptId, 'verifying', 'verified', null, s)
        await db
          .prepare(
            "UPDATE resource_registry_bindings SET source='unconfirmed' WHERE resource_id=?",
          )
          .bind(id)
          .run()
        return Response.json({
          authorized: await store.advance(
            attemptId,
            'verified',
            'settlement_pending',
            null,
            s,
          ),
          attemptId,
        })
      }
      return Response.json({ authorized: true, attemptId })
    } catch {
      return Response.json({ authorized: false })
    }
  }
  if (body.action !== 'review')
    return new Response('Unknown fixture', { status: 404 })
  const row = await db
    .prepare(
      'SELECT r.*,b.config_hash,b.onchain_resource_id FROM api_resources r LEFT JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=?',
    )
    .bind(id)
    .first<Record<string, unknown>>()
  let changed = false
  const p = { ...policy }
  if (body.mode === 'wrong-chain-policy') p.chainId = 1 as 8453
  if (body.mode === 'wrong-address') p.address = owner
  if (body.mode === 'wrong-code-policy')
    p.runtimeCodeHash = '0x' + '99'.repeat(32)
  const rpc = async (method: string, params: unknown[]) => {
    if (!changed) {
      changed = true
      if (body.mode === 'price-race')
        await db
          .prepare('UPDATE api_resources SET price_atomic=? WHERE id=?')
          .bind('2000', id)
          .run()
      if (body.mode === 'aba') {
        await db
          .prepare('UPDATE api_resources SET enabled=0 WHERE id=?')
          .bind(id)
          .run()
        await db
          .prepare('UPDATE api_resources SET enabled=1 WHERE id=?')
          .bind(id)
          .run()
      }
      if (body.mode === 'owner-race')
        await db
          .prepare('UPDATE merchants SET wallet_address=? WHERE id=?')
          .bind(other, row!.merchant_id)
          .run()
      if (body.mode === 'binding-delete-aba') {
        await db
          .prepare('DELETE FROM resource_registry_bindings WHERE resource_id=?')
          .bind(id)
          .run()
        await db
          .prepare(
            'INSERT INTO resource_registry_bindings (resource_id,original_owner,onchain_resource_id,config_salt,config_hash,registry_version,source,checked_at) VALUES (?,?,?,?,?,?,?,?)',
          )
          .bind(
            id,
            owner,
            row!.onchain_resource_id,
            salt,
            row!.config_hash,
            '1',
            'local_simulation',
            now,
          )
          .run()
      }
      if (body.mode === 'binding-race')
        await db
          .prepare(
            'UPDATE resource_registry_bindings SET checked_at=checked_at+1 WHERE resource_id=?',
          )
          .bind(id)
          .run()
      if (body.mode === 'fault')
        await db
          .prepare(
            "CREATE TRIGGER sg07_review_fault AFTER INSERT ON registry_evidence_journal WHEN NEW.kind='observation' BEGIN SELECT RAISE(ABORT,'local_review_interruption'); END",
          )
          .run()
    }
    if (body.mode === 'timeout') now += 6000
    if (body.mode === 'malformed') return null
    if (method === 'eth_chainId')
      return body.mode === 'wrong-chain' ? '0x1' : '0x2105'
    if (method === 'eth_getBlockByNumber') {
      const latest =
        params[0] === 'latest' ||
        params[0] === '0x' + ((body.block ?? 100) + 2).toString(16)
      return {
        number: '0x' + ((body.block ?? 100) + (latest ? 2 : 0)).toString(16),
        hash: latest
          ? '0x' + '66'.repeat(32)
          : body.mode === 'conflict'
            ? '0x' + '33'.repeat(32)
            : blockHash,
        timestamp:
          '0x' +
          Math.floor(
            (now -
              (body.mode === 'stale' ? 3601000 : 60000) +
              (latest ? 4000 : 0)) /
              1000,
          ).toString(16),
      }
    }
    if (method === 'eth_getCode')
      return String(params[0]).toLowerCase() === policy.address.toLowerCase()
        ? code
        : '0x'
    const data = (params[0] as { data: string }).data
    if (
      data ===
      encodeFunctionData({ abi: registryAbi, functionName: 'CHAIN_ID' })
    )
      return encodeFunctionResult({
        abi: registryAbi,
        functionName: 'CHAIN_ID',
        result: 8453n,
      })
    return encodeFunctionResult({
      abi: registryAbi,
      functionName: 'getResource',
      result: {
        owner: body.mode === 'wrong-owner' ? other : owner,
        pendingOwner: body.mode === 'pending' ? other : zero,
        payout: body.mode === 'wrong-payout' ? other : owner,
        priceAtomic: body.mode === 'wrong-price' ? 999n : 1000n,
        configHash: (body.mode === 'wrong-hash'
          ? '0x' + '88'.repeat(32)
          : row!.config_hash) as Hex,
        version: 1n,
        enabled: body.mode !== 'disabled',
      },
    })
  }
  try {
    const review = createRegistryReview(
      db,
      p,
      {
        kind: body.source ?? 'local_simulation',
        id: 'isolated_mock_rpc',
      } as ReviewSource,
      rpc,
      clock,
    )
    const results =
      body.mode === 'concurrent'
        ? await Promise.all([review(id), review(id)])
        : [await review(id)]
    return Response.json({ localSimulationOnly: true, results })
  } catch {
    return Response.json(
      { error: 'review_failed', localSimulationOnly: true },
      { status: 503 },
    )
  }
}
