import { createLocalGateway } from '../../server/sg05/gateway'
import {
  boundedJson,
  boundedResponse,
  deadline,
  GatewayError,
  reply,
} from '../../server/sg05/bounds'
import {
  commitment,
  resourceId,
  type RegistryState,
} from '../../server/sg05/registry'
import { PaymentStore } from '../../server/sg05/store'
import {
  reconcileUnknown,
  type LocalEvidence,
} from '../../server/sg05/reconcile'
import { cdpCredentialGuard } from '../../server/sg05/protocol'
import { walletAddress } from '../../shared/resources'
import { readJson } from '../../server/sg03/http'
type Env = {
  SIGNALARC_DB: D1Database
  APP_ORIGIN: string
  APP_ENV: string
  SG05_LOCAL_ONLY?: string
  MOCK_ORIGIN: string
  CF_PAGES_URL?: string
}
const nativeFetch = globalThis.fetch
let permittedOrigin: string | undefined
let blocked = 0
function installEgress(origin: string) {
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.origin !== origin
  )
    throw Error('Loopback only')
  if (permittedOrigin && permittedOrigin !== origin)
    throw Error('Isolate transport changed')
  permittedOrigin = origin
  globalThis.fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    if (
      target.origin !== origin ||
      target.search ||
      ![
        '/supported',
        '/verify',
        '/settle',
        '/reconcile',
        '/upstream',
        '/clock',
      ].includes(target.pathname)
    ) {
      blocked++
      throw Error('SG05 blocked external egress')
    }
    const method = init?.method ?? 'GET'
    if (
      (['/supported', '/upstream', '/clock'].includes(target.pathname)
        ? 'GET'
        : 'POST') !== method
    )
      throw Error('Unexpected mock method')
    const response = await nativeFetch(input, { ...init, redirect: 'manual' })
    if (target.pathname === '/upstream') return response
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel()
      throw Error('Facilitator transport rejected')
    }
    const value = await boundedResponse(
      response,
      8192,
      init?.signal ?? undefined,
    )
    return Response.json(value)
  }
}
async function trustedClock(env: Env) {
  return deadline(async (signal) => {
    const response = await fetch(`${env.MOCK_ORIGIN}/clock`, {
      method: 'GET',
      headers: { 'Cache-Control': 'no-store' },
      signal,
    })
    const body = (await boundedResponse(response, 1024, signal)) as {
      now: number
      localSimulationOnly: boolean
    }
    if (body.localSimulationOnly !== true)
      throw new GatewayError(503, 'local_clock_required')
    return body.now
  })
}
const salt = `0x${'11'.repeat(32)}`
const payout = '0x000000000000000000000000000000000000b0b1'
const resourceUrl = 'https://api.example.com/v1/local-json'
async function control(request: Request, env: Env) {
  if (
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes'
  )
    return reply(403, { error: 'local_control_only' })
  const body = (await readJson(request)) as Record<string, unknown>
  const db = env.SIGNALARC_DB
  const now = await trustedClock(env)
  if (body.action === 'legacySeed') {
    await db
      .prepare(
        'INSERT INTO merchants (id,wallet_address,created_at,updated_at) VALUES (?,?,?,?)',
      )
      .bind('legacy-local-merchant', String(body.owner).toLowerCase(), 1, 1)
      .run()
    await db
      .prepare(
        'INSERT INTO api_resources (id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        '00000000-0000-4000-8000-000000000001',
        'legacy-local-merchant',
        'LOCAL MIGRATION FIXTURE',
        resourceUrl,
        '{"type":"json","maxBytes":4096,"redirects":"error"}',
        '1',
        payout,
        'eip155:8453',
        0,
        1,
        1,
      )
      .run()
    await db
      .prepare(
        'INSERT INTO payment_attempts (id,merchant_id,resource_id,idempotency_key,network,amount_atomic,status,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        'legacy-local-attempt',
        'legacy-local-merchant',
        '00000000-0000-4000-8000-000000000001',
        'legacy-local-key',
        'eip155:8453',
        '1',
        'created',
        1,
        1,
      )
      .run()
    return reply(200, { localSimulationOnly: true })
  }
  if (body.action === 'seed') {
    const owner = walletAddress(body.owner).toLowerCase(),
      id = String(body.id)
    const merchant = crypto.randomUUID()
    await db
      .prepare(
        'INSERT INTO merchants (id,wallet_address,created_at,updated_at) VALUES (?,?,?,?) ON CONFLICT(wallet_address) DO NOTHING',
      )
      .bind(merchant, owner, now, now)
      .run()
    const m = await db
      .prepare('SELECT id FROM merchants WHERE wallet_address = ?')
      .bind(owner)
      .first<{ id: string }>()
    await db
      .prepare(
        'INSERT INTO api_resources (id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        m!.id,
        'LOCAL SIMULATION ONLY',
        resourceUrl,
        '{"type":"json","maxBytes":4096,"redirects":"error"}',
        '1000',
        payout,
        'eip155:8453',
        1,
        now,
        now,
      )
      .run()
    const onchain = resourceId(owner, id),
      config = commitment(onchain, resourceUrl, 4096, salt)
    await db
      .prepare(
        'INSERT INTO resource_registry_bindings (resource_id,original_owner,onchain_resource_id,registry_address,config_salt,config_hash,registry_version,source,checked_at) VALUES (?,?,?,?,?,?,?,?,?)',
      )
      .bind(
        id,
        owner,
        onchain,
        null,
        salt,
        config,
        '1',
        'local_simulation',
        now,
      )
      .run()
    await db
      .prepare(
        'CREATE TABLE IF NOT EXISTS sg05_registry_fixture (id TEXT PRIMARY KEY, state TEXT NOT NULL)',
      )
      .run()
    const state: RegistryState = {
      id: onchain,
      owner,
      pendingOwner: null,
      payout,
      priceAtomic: '1000',
      configHash: config,
      version: '1',
      enabled: true,
      observedAt: now,
      localSimulationOnly: true,
    }
    await db
      .prepare('INSERT INTO sg05_registry_fixture (id,state) VALUES (?,?)')
      .bind(onchain, JSON.stringify(state))
      .run()
    return reply(200, { id, onchain, localSimulationOnly: true })
  }
  if (body.action === 'inspect') {
    const attempts = (
      await db
        .prepare(
          'SELECT id,resource_id,merchant_id,phase,status,authorization_key,authorization_fingerprint,failure_code,config_revision,evidence_kind FROM payment_attempts',
        )
        .all()
    ).results
    const receipts = (
      await db
        .prepare(
          'SELECT attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,evidence_kind FROM payment_receipts',
        )
        .all()
    ).results
    const analytics = (
      await db
        .prepare(
          'SELECT attempt_id,event_type,evidence_kind FROM analytics_events',
        )
        .all()
    ).results
    const resources = (
      await db
        .prepare(
          'SELECT id,enabled,payment_revision,price_atomic FROM api_resources',
        )
        .all()
    ).results
    const bindings = (
      await db
        .prepare(
          'SELECT source,registry_address,block_hash,block_number FROM resource_registry_bindings',
        )
        .all()
    ).results
    return reply(200, { attempts, receipts, analytics, resources, bindings })
  }
  if (body.action === 'mutate') {
    const columns = [
      'price_atomic',
      'payout_address',
      'enabled',
      'upstream_url',
      'response_config',
    ]
    if (!columns.includes(String(body.field)))
      return reply(400, { error: 'invalid_fixture_field' })
    await db
      .prepare(
        `UPDATE api_resources SET ${body.field} = ?, updated_at = ? WHERE id = ?`,
      )
      .bind(body.value as string | number, now, String(body.id))
      .run()
    return reply(200, { changed: true })
  }
  if (body.action === 'registryPatch') {
    const binding = await db
      .prepare(
        'SELECT onchain_resource_id FROM resource_registry_bindings WHERE resource_id = ?',
      )
      .bind(String(body.id))
      .first<{ onchain_resource_id: string }>()
    const row = await db
      .prepare('SELECT state FROM sg05_registry_fixture WHERE id = ?')
      .bind(binding!.onchain_resource_id)
      .first<{ state: string }>()
    const patch = body.patch as Record<string, unknown>
    if (
      Object.keys(patch).some(
        (k) =>
          ![
            'owner',
            'payout',
            'priceAtomic',
            'version',
            'enabled',
            'pendingOwner',
            'observedAt',
            'configHash',
            'localSimulationOnly',
          ].includes(k),
      )
    )
      return reply(400, { error: 'invalid_registry_patch' })
    await db
      .prepare('UPDATE sg05_registry_fixture SET state = ? WHERE id = ?')
      .bind(
        JSON.stringify({ ...JSON.parse(row!.state), ...patch }),
        binding!.onchain_resource_id,
      )
      .run()
    return reply(200, { changed: true })
  }
  if (body.action === 'binding') {
    if (body.mode === 'delete')
      await db
        .prepare('DELETE FROM resource_registry_bindings WHERE resource_id = ?')
        .bind(String(body.id))
        .run()
    else if (body.mode === 'stale')
      await db
        .prepare(
          'UPDATE resource_registry_bindings SET checked_at = ? WHERE resource_id = ?',
        )
        .bind(1, String(body.id))
        .run()
    else if (body.mode === 'unconfirmed')
      await db
        .prepare(
          'UPDATE resource_registry_bindings SET source = ? WHERE resource_id = ?',
        )
        .bind('unconfirmed', String(body.id))
        .run()
    else return reply(400, { error: 'invalid_binding_mode' })
    return reply(200, { changed: true })
  }
  if (body.action === 'expire') {
    await db
      .prepare(
        'UPDATE payment_attempts SET operation_deadline = ?, expires_at = ? WHERE id = ?',
      )
      .bind(0, 0, String(body.id))
      .run()
    return reply(200, { changed: true })
  }
  if (body.action === 'fault') {
    await db.prepare('DROP TRIGGER IF EXISTS sg05_fault').run()
    if (body.mode === 'receipt')
      await db
        .prepare(
          "CREATE TRIGGER sg05_fault BEFORE INSERT ON payment_receipts BEGIN SELECT RAISE(ABORT,'local_receipt_fault'); END",
        )
        .run()
    else if (body.mode === 'claim')
      await db
        .prepare(
          "CREATE TRIGGER sg05_fault BEFORE UPDATE OF phase ON payment_attempts WHEN NEW.phase = 'verifying' BEGIN SELECT RAISE(ABORT,'local_claim_fault'); END",
        )
        .run()
    else if (body.mode === 'release')
      await db
        .prepare(
          "CREATE TRIGGER sg05_fault BEFORE UPDATE OF phase ON payment_attempts WHEN NEW.phase = 'fulfilled' BEGIN SELECT RAISE(ABORT,'local_release_fault'); END",
        )
        .run()
    return reply(200, { fault: body.mode })
  }
  const store = new PaymentStore(db, () => trustedClock(env))
  if (body.action === 'recover')
    return reply(200, { recovered: await store.recover() })
  if (body.action === 'reconcile') {
    const outcome = await reconcileUnknown(store, String(body.id), (identity) =>
      deadline(async (signal) => {
        const response = await fetch(`${env.MOCK_ORIGIN}/reconcile`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ identity }),
          signal,
        })
        return boundedResponse(response, 8192, signal) as Promise<LocalEvidence>
      }),
    )
    return reply(200, { outcome })
  }
  if (body.action === 'illegalTransition') {
    let blocked = false
    try {
      await db
        .prepare("UPDATE payment_attempts SET phase = 'fulfilled' WHERE id = ?")
        .bind(String(body.id))
        .run()
    } catch {
      blocked = true
    }
    return reply(200, { blocked })
  }
  return reply(404, { error: 'unknown_control' })
}
export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Env
}): Promise<Response> {
  try {
    if (
      env.SG05_LOCAL_ONLY !== 'yes' ||
      env.APP_ENV !== 'local' ||
      new URL(request.url).origin !== env.APP_ORIGIN ||
      new URL(request.url).hostname !== '127.0.0.1' ||
      !env.CF_PAGES_URL ||
      !['127.0.0.1', 'localhost'].includes(new URL(env.CF_PAGES_URL).hostname)
    )
      return reply(404, { error: 'local_fixture_disabled' })
    const meta = await env.SIGNALARC_DB.prepare('SELECT 1').all()
    if (meta.meta.served_by !== 'miniflare.db')
      return reply(404, { error: 'local_d1_required' })
    installEgress(env.MOCK_ORIGIN)
    const path = new URL(request.url).pathname
    if (path === '/sg05/control') return await control(request, env)
    if (path === '/sg05/modules') {
      const vector = resourceId(
        '0x00000000000000000000000000000000000a11ce',
        '8dc286d7-8b04-4411-96a0-422aad965f31',
      )
      return reply(200, {
        cdpCredentialGuard: cdpCredentialGuard(env.MOCK_ORIGIN),
        localSimulationOnly: true,
        mappingId: vector,
        mappingHash: commitment(
          vector,
          'https://api.example.com/v1/data',
          65536,
          salt,
        ),
      })
    }
    if (path === '/sg05/egress') {
      for (const target of [
        'https://api.cdp.coinbase.com/platform/v2/x402/settle',
        'https://mainnet.base.org',
        'https://example.invalid',
        'http://169.254.169.254/',
      ]) {
        try {
          await fetch(target)
        } catch {
          /* must fail before transport */
        }
      }
      return reply(200, { blocked })
    }
    if (path === '/sg05/guards') {
      const absent = await onRequest({
        request,
        env: { ...env, SG05_LOCAL_ONLY: undefined },
      })
      const deployed = await onRequest({
        request,
        env: { ...env, CF_PAGES_URL: 'https://example.pages.dev' },
      })
      const host = await onRequest({
        request: new Request('https://example.invalid/sg05/pay/x'),
        env,
      })
      return reply(200, {
        absent: absent.status,
        deployed: deployed.status,
        host: host.status,
      })
    }
    const gateway = createLocalGateway({
      db: env.SIGNALARC_DB,
      origin: env.APP_ORIGIN,
      facilitatorOrigin: env.MOCK_ORIGIN,
      clock: () => trustedClock(env),
      registry: async (id) => {
        const row = await env.SIGNALARC_DB.prepare(
          'SELECT state FROM sg05_registry_fixture WHERE id = ?',
        )
          .bind(id)
          .first<{ state: string }>()
        if (!row) throw new GatewayError(503, 'registry_unavailable')
        return boundedJson(row.state) as RegistryState
      },
      upstream: (_url, init) => fetch(`${env.MOCK_ORIGIN}/upstream`, init),
    })
    return await gateway(request)
  } catch (error) {
    return reply(error instanceof GatewayError ? error.status : 503, {
      error: error instanceof GatewayError ? error.code : 'fixture_unavailable',
      localSimulationOnly: true,
    })
  }
}
