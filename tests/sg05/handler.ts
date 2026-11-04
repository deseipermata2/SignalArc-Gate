import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { HTTPFacilitatorClient } from '@x402/core/server'
import {
  localPilotManifest,
  type LocalPilotAuthority,
} from '../../server/sg07/internal-manifest'
import {
  localChainVerifier,
  localReconciliationAdmission,
  localChainRead,
  localEvidencePolicy,
} from './chain-verifier'
import { createSettlementAdmissionReview } from '../../server/sg07/settlement-admission'
import { createLocalInternalJsonPilot } from '../../server/sg07/internal-json'
import { createLocalUpstreamAccess } from '../../server/sg07/upstream'
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
  snapshot,
  resourceId,
  type Snapshot,
  type RegistryState,
} from '../../server/sg05/registry'
import { PaymentStore } from '../../server/sg05/store'
import {
  reconcileUnknown,
  type LocalEvidence,
} from '../../server/sg05/reconcile'
import {
  issuedResourceUrl,
  cdpCredentialGuard,
} from '../../server/sg05/protocol'
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
        '/chain',
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
    await db
      .prepare(
        'CREATE TABLE IF NOT EXISTS sg05_upstream_policy (resourceId TEXT PRIMARY KEY, merchantId TEXT NOT NULL, url TEXT NOT NULL)',
      )
      .run()
    await db
      .prepare('INSERT INTO sg05_upstream_policy VALUES (?,?,?)')
      .bind(id, m!.id, resourceUrl)
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
  if (
    body.action === 'pilotReplace' ||
    body.action === 'pilotRecreate' ||
    body.action === 'pilotFaultBatch' ||
    body.action === 'pilotRevoke' ||
    body.action === 'pilotReplayAdmission' ||
    body.action === 'pilotRegister' ||
    body.action === 'pilotInspect' ||
    body.action === 'pilotFault' ||
    body.action === 'pilotAttach' ||
    body.action === 'pilotProbe'
  ) {
    await db
      .prepare(
        "CREATE TABLE IF NOT EXISTS sg07_internal_pilot_fixture (id TEXT PRIMARY KEY,manifest TEXT NOT NULL,admission TEXT NOT NULL,revoked INTEGER NOT NULL DEFAULT 0 CHECK(revoked IN (0,1)),fault TEXT NOT NULL DEFAULT 'none',calls INTEGER NOT NULL DEFAULT 0)",
      )
      .run()
    // Test-only operator ledger. Revocation is permanent; no re-enable/update/delete path.
    for (const sql of [
      "CREATE TRIGGER IF NOT EXISTS pilot_no_replace BEFORE INSERT ON sg07_internal_pilot_fixture WHEN EXISTS(SELECT 1 FROM sg07_internal_pilot_fixture WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'pilot admission already exists'); END",
      "CREATE TRIGGER IF NOT EXISTS pilot_no_delete BEFORE DELETE ON sg07_internal_pilot_fixture BEGIN SELECT RAISE(ABORT,'pilot admission is permanent'); END",
      "CREATE TRIGGER IF NOT EXISTS pilot_immutable BEFORE UPDATE OF id,admission ON sg07_internal_pilot_fixture BEGIN SELECT RAISE(ABORT,'immutable admission'); END",
      "CREATE TRIGGER IF NOT EXISTS pilot_sticky BEFORE UPDATE OF revoked ON sg07_internal_pilot_fixture WHEN OLD.revoked=1 AND NEW.revoked<>1 BEGIN SELECT RAISE(ABORT,'revocation is permanent'); END",
      'CREATE TRIGGER IF NOT EXISTS pilot_revoke_revision AFTER UPDATE OF revoked ON sg07_internal_pilot_fixture WHEN OLD.revoked<>NEW.revoked BEGIN UPDATE api_resources SET payment_revision=payment_revision+1 WHERE id=NEW.id; END',
    ])
      await db.prepare(sql).run()
    if (body.action === 'pilotRevoke')
      await db
        .prepare('UPDATE sg07_internal_pilot_fixture SET revoked=1 WHERE id=?')
        .bind(body.id)
        .run()
    if (body.action === 'pilotReplayAdmission') {
      let blocked = false
      try {
        await db
          .prepare(
            'UPDATE sg07_internal_pilot_fixture SET revoked=0 WHERE id=?',
          )
          .bind(body.id)
          .run()
      } catch {
        blocked = true
      }
      return reply(200, { blocked })
    }
    if (body.action === 'pilotRecreate' || body.action === 'pilotFaultBatch') {
      let blocked = false
      try {
        await db.batch(
          body.action === 'pilotRecreate'
            ? [
                db
                  .prepare('DELETE FROM sg07_internal_pilot_fixture WHERE id=?')
                  .bind(body.id),
                db
                  .prepare(
                    'INSERT INTO sg07_internal_pilot_fixture (id,manifest,admission) VALUES (?,?,?)',
                  )
                  .bind(body.id, '{}', '{}'),
              ]
            : [
                db
                  .prepare(
                    'UPDATE sg07_internal_pilot_fixture SET revoked=1 WHERE id=?',
                  )
                  .bind(body.id),
                db
                  .prepare(
                    'UPDATE sg07_internal_pilot_fixture SET admission=? WHERE id=?',
                  )
                  .bind('{}', body.id),
              ],
        )
      } catch {
        blocked = true
      }
      return reply(200, { blocked })
    }
    if (body.action === 'pilotReplace') {
      let blocked = false
      try {
        await db
          .prepare(
            'INSERT OR REPLACE INTO sg07_internal_pilot_fixture (id,manifest,admission) VALUES (?,?,?)',
          )
          .bind(body.id, '{}', '{}')
          .run()
      } catch {
        blocked = true
      }
      return reply(200, { blocked })
    }
    if (body.action === 'pilotRegister') {
      const captured = await snapshot(
        db,
        String(body.id),
        async (id) => {
          const row = await db
            .prepare('SELECT state FROM sg05_registry_fixture WHERE id=?')
            .bind(id)
            .first<{ state: string }>()
          if (!row) throw new GatewayError(503, 'fixture_registry_missing')
          return boundedJson(row.state) as RegistryState
        },
        () => trustedClock(env),
      )
      await db
        .prepare(
          'INSERT INTO sg07_internal_pilot_fixture (id,manifest,admission) VALUES (?,?,?)',
        )
        .bind(
          body.id,
          JSON.stringify(captured),
          JSON.stringify(localPilotManifest(captured)),
        )
        .run()
    }
    if (body.action === 'pilotFault')
      await db
        .prepare('UPDATE sg07_internal_pilot_fixture SET fault=? WHERE id=?')
        .bind(body.fault, body.id)
        .run()
    if (body.action === 'pilotAttach')
      await db
        .prepare(
          'UPDATE sg07_internal_pilot_fixture SET manifest=(SELECT manifest FROM sg07_internal_pilot_fixture WHERE id=?) WHERE id=?',
        )
        .bind(body.sourceId, body.id)
        .run()
    if (body.action === 'pilotProbe') {
      const row = await db
        .prepare('SELECT manifest FROM sg07_internal_pilot_fixture WHERE id=?')
        .bind(body.id)
        .first<{ manifest: string }>()
      const entry = JSON.parse(row!.manifest) as Snapshot
      let blocked = false
      try {
        const authority = pilotAuthority(db, String(body.id), env)
        const read = authority.read
        if (String(body.mode).startsWith('manifest:'))
          authority.read = async () => {
            const row = (await read())!
            return {
              ...row,
              manifest: {
                ...(row.manifest as object),
                [String(body.mode).slice(9)]: 'FORGED',
              },
            }
          }
        const access = await createLocalInternalJsonPilot(
          db,
          {
            origin:
              body.mode === 'public'
                ? 'https://gate.signalarc.fun'
                : env.APP_ORIGIN,
            appEnv: 'local',
            optIn: body.mode !== 'no-opt-in',
            pagesUrl: env.CF_PAGES_URL!,
          },
          entry,
          null,
          authority,
        )
        if (body.mode === 'wrong-merchant')
          await access.assertEligible({
            ...entry,
            merchantId: 'wrong-merchant',
          })
        else
          await access.request(entry.resource.upstreamUrl, {
            method: 'GET',
            redirect: 'manual',
            cache: 'no-store',
            headers: {
              Accept: 'application/json',
              ...(body.mode === 'credentials'
                ? { Authorization: 'LOCAL_BUYER_SECRET' }
                : {}),
            },
            signal: new AbortController().signal,
          })
      } catch {
        blocked = true
      }
      return reply(200, { blocked })
    }
    const row = await db
      .prepare(
        'SELECT calls,fault,revoked,admission FROM sg07_internal_pilot_fixture WHERE id=?',
      )
      .bind(body.id)
      .first()
    return reply(200, { pilot: row, localSimulationOnly: true })
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
          'SELECT attempt_id,transaction_hash,network,amount_atomic,payer_address,payout_address,block_number,evidence_kind,settlement_json FROM payment_receipts',
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
  if (body.action === 'denyUpstream') {
    await db
      .prepare('DELETE FROM sg05_upstream_policy WHERE resourceId=?')
      .bind(String(body.id))
      .run()
    return reply(200, { revoked: true })
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
  if (body.action === 'legacyEvidence') {
    await db
      .prepare(
        "UPDATE payment_attempts SET evidence_kind='legacy_unconfirmed' WHERE id=?",
      )
      .bind(String(body.id))
      .run()
    return reply(200, { quarantined: true })
  }
  if (body.action === 'expireOperation') {
    await db
      .prepare('UPDATE payment_attempts SET operation_deadline=? WHERE id=?')
      .bind(0, String(body.id))
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
    else if (body.mode === 'analytics')
      await db
        .prepare(
          "CREATE TRIGGER sg05_fault BEFORE INSERT ON analytics_events BEGIN SELECT RAISE(ABORT,'local_analytics_fault'); END",
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
  if (body.action === 'reconcileHung')
    return reply(200, {
      outcome: await reconcileUnknown(
        store,
        String(body.id),
        () => new Promise(() => {}),
      ),
    })
  if (body.action === 'localAdvance')
    return reply(200, {
      changed: await store.advance(
        String(body.id),
        'settlement_unknown',
        'failed',
      ),
    })
  if (body.action === 'mismatchedSettlement') {
    const attempt = await store.get(String(body.id))
    if (!attempt) throw new GatewayError(404, 'attempt_missing')
    const forged = {
      ...attempt,
      ...(body.patch as Record<string, unknown>),
    } as import('../../server/sg05/store').Attempt
    return reply(200, {
      changed: await store.settle(
        forged,
        {
          success: true,
          transaction: '0x' + '55'.repeat(32),
          network: 'eip155:8453',
          payer: forged.buyer_address!,
          amount: forged.amount_atomic,
          extra: { asset: forged.asset, recipient: forged.recipient },
        },
        'settlement_unknown',
      ),
    })
  }
  if (body.action === 'duplicateSettlement') {
    const attempt = await store.get(String(body.id))
    if (!attempt) throw new GatewayError(404, 'attempt_missing')
    const result = body.result as import('@x402/core/types').SettleResponse
    return reply(200, {
      changed: await store.settle(attempt, result, 'settlement_unknown'),
    })
  }
  if (body.action === 'recover')
    return reply(200, { recovered: await store.recover() })
  if (body.action === 'authBoundary')
    return reply(200, {
      jwtFactory: typeof generateJwt,
      httpClient: typeof HTTPFacilitatorClient,
      credentialsUsed: false,
    })
  if (body.action === 'admissionProfile') {
    let blocked = false,
      calls = 0
    try {
      createSettlementAdmissionReview(
        db,
        {
          origin:
            body.mode === 'public'
              ? 'https://gate.signalarc.fun'
              : env.APP_ORIGIN,
          optIn: body.mode !== 'no-opt-in',
          realm: (body.mode === 'production'
            ? 'production'
            : 'local_simulation') as 'local_simulation',
        },
        localEvidencePolicy,
        async () => {
          calls++
          throw Error('No RPC permitted')
        },
        () => trustedClock(env),
      )
    } catch {
      blocked = true
    }
    return reply(200, { blocked, calls })
  }
  if (body.action === 'admissionReview') {
    const a = await store.get(String(body.id))
    if (!a) throw new GatewayError(404, 'missing_fixture_attempt')
    const lookup = await fetch(env.MOCK_ORIGIN + '/reconcile', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identity: a.authorization_key }),
    })
    const evidence = (await boundedResponse(lookup, 8192)) as LocalEvidence
    if (!evidence.settlement)
      throw new GatewayError(503, 'fixture_settlement_unknown')
    const { rpc, nonce } = await localChainRead(
      env.MOCK_ORIGIN,
      a,
      evidence.settlement,
      new AbortController().signal,
    )
    let admissionOffset = 0
    const review = createSettlementAdmissionReview(
      db,
      { origin: env.APP_ORIGIN, optIn: true, realm: 'local_simulation' },
      localEvidencePolicy,
      rpc,
      async () => (await trustedClock(env)) + admissionOffset,
    )
    const candidate = await review.prepare(
      body.merchant ? String(body.merchant) : a.merchant_id,
      a.id,
      evidence.settlement.transaction,
      body.nonce ? String(body.nonce) : nonce,
    )
    if (body.mode === 'race')
      await db
        .prepare("UPDATE payment_attempts SET phase='failed' WHERE id=?")
        .bind(a.id)
        .run()
    const quarantine = async () => {
      const row = await db
        .prepare('SELECT * FROM settlement_evidence_observations WHERE id=?')
        .bind(candidate.reviewId)
        .first<Record<string, unknown>>()
      await db
        .prepare(
          `INSERT INTO settlement_evidence_observations (id,attempt_id,merchant_id,resource_id,authorization_key,authorization_fingerprint,network,asset,payer_address,recipient_address,amount_atomic,transaction_hash,provenance,source_id,observed_at,outcome,evidence_json) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          crypto.randomUUID(),
          row!.attempt_id,
          row!.merchant_id,
          row!.resource_id,
          row!.authorization_key,
          row!.authorization_fingerprint,
          row!.network,
          row!.asset,
          row!.payer_address,
          row!.recipient_address,
          row!.amount_atomic,
          row!.transaction_hash,
          row!.provenance,
          row!.source_id,
          row!.observed_at,
          'conflict',
          row!.evidence_json,
        )
        .run()
    }
    let replacementBlocked = false
    if (body.mode === 'conflict' || body.mode === 'replace-conflict')
      await quarantine()
    if (body.mode === 'replace-conflict') {
      try {
        await db
          .prepare(
            `INSERT OR REPLACE INTO settlement_evidence_observations SELECT id,attempt_id,merchant_id,resource_id,authorization_key,authorization_fingerprint,network,asset,payer_address,recipient_address,amount_atomic,transaction_hash,provenance,source_id,observed_at,'rpc_observation_only',evidence_json FROM settlement_evidence_observations WHERE attempt_id=? AND outcome='conflict'`,
          )
          .bind(a.id)
          .run()
      } catch {
        replacementBlocked = true
      }
    }
    if (body.mode === 'expired') admissionOffset = 10001
    let blocked = false
    try {
      if (body.mode === 'serialized')
        await review.consume(body.candidate as object, a.merchant_id, a.id)
      else if (body.mode === 'clone')
        await review.consume(
          JSON.parse(JSON.stringify(candidate)),
          a.merchant_id,
          a.id,
        )
      else if (body.mode === 'foreign-instance')
        await createSettlementAdmissionReview(
          db,
          { origin: env.APP_ORIGIN, optIn: true, realm: 'local_simulation' },
          localEvidencePolicy,
          rpc,
          () => trustedClock(env),
        ).consume(candidate, a.merchant_id, a.id)
      else if (body.mode === 'wrong-owner')
        await review.consume(
          candidate,
          '00000000-0000-4000-8000-000000000000',
          a.id,
        )
      else {
        await review.consume(candidate, a.merchant_id, a.id)
        if (body.mode === 'late-conflict') {
          await quarantine()
          blocked = !(await store.settle(
            a,
            evidence.settlement,
            'settlement_unknown',
          ))
        }
        if (body.mode === 'replay')
          await review.consume(candidate, a.merchant_id, a.id)
      }
    } catch {
      blocked = true
    }
    return reply(200, {
      candidate,
      blocked,
      replacementBlocked,
      observations: (
        await db
          .prepare(
            'SELECT id,outcome FROM settlement_evidence_observations WHERE attempt_id=?',
          )
          .bind(a.id)
          .all()
      ).results,
    })
  }
  if (body.action === 'reconcile') {
    const pilotTable = await db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='sg07_internal_pilot_fixture'",
      )
      .first()
    const pilot =
      pilotTable &&
      (await db
        .prepare(
          'SELECT p.id FROM sg07_internal_pilot_fixture p JOIN payment_attempts a ON a.resource_id=p.id WHERE a.id=?',
        )
        .bind(body.id)
        .first())
    const outcome = await reconcileUnknown(
      store,
      String(body.id),
      (identity) =>
        deadline(async (signal) => {
          const response = await fetch(`${env.MOCK_ORIGIN}/reconcile`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ identity }),
            signal,
          })
          return boundedResponse(
            response,
            8192,
            signal,
          ) as Promise<LocalEvidence>
        }),
      pilot
        ? localReconciliationAdmission(
            db,
            env.APP_ORIGIN,
            env.MOCK_ORIGIN,
            () => trustedClock(env),
          )
        : undefined,
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
    const pilotTable = await env.SIGNALARC_DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' AND name='sg07_internal_pilot_fixture'",
    ).first()
    const resource = new URL(request.url).pathname.match(
      /^\/sg05\/pay\/([a-f0-9-]{36})$/,
    )?.[1]
    const pilot =
      pilotTable && resource
        ? await env.SIGNALARC_DB.prepare(
            'SELECT manifest,fault FROM sg07_internal_pilot_fixture WHERE id=?',
          )
            .bind(resource)
            .first<{ manifest: string; fault: string }>()
        : null
    let internal:
      import('../../server/sg05/upstream').UpstreamAccess | undefined
    if (pilot) {
      let paymentAttempt = new URL(request.url).searchParams.get('attempt')
      if (!paymentAttempt && request.headers.get('PAYMENT-SIGNATURE')) {
        const issued = new URL(
          issuedResourceUrl(request.headers.get('PAYMENT-SIGNATURE')!),
        )
        if (
          issued.origin === env.APP_ORIGIN &&
          issued.pathname === new URL(request.url).pathname
        )
          paymentAttempt = issued.searchParams.get('attempt')
      }
      const access = await createLocalInternalJsonPilot(
        env.SIGNALARC_DB,
        {
          origin: env.APP_ORIGIN,
          appEnv: env.APP_ENV,
          optIn: env.SG05_LOCAL_ONLY === 'yes',
          pagesUrl: env.CF_PAGES_URL!,
        },
        JSON.parse(pilot.manifest),
        paymentAttempt,
        pilotAuthority(env.SIGNALARC_DB, resource!, env),
      )
      internal = {
        assertEligible: access.assertEligible,
        validateLocalSettlement: access.validateLocalSettlement,
        request: async (url, init) => {
          await env.SIGNALARC_DB.prepare(
            'UPDATE sg07_internal_pilot_fixture SET calls=calls+1 WHERE id=?',
          )
            .bind(resource!)
            .run()
          if (pilot.fault === 'throw')
            throw new GatewayError(502, 'local_internal_delivery_failure')
          if (pilot.fault === 'timeout') return new Promise(() => {})
          if (pilot.fault === 'revoke')
            await env.SIGNALARC_DB.prepare(
              'UPDATE sg07_internal_pilot_fixture SET revoked=1 WHERE id=?',
            )
              .bind(resource!)
              .run()
          if (pilot.fault === 'configuration-change')
            await env.SIGNALARC_DB.prepare(
              'UPDATE api_resources SET enabled=0 WHERE id=?',
            )
              .bind(resource!)
              .run()
          return access.request(url, init)
        },
      }
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
      upstream:
        internal ??
        createLocalUpstreamAccess(
          async (resource, merchant) => {
            return env.SIGNALARC_DB.prepare(
              'SELECT * FROM sg05_upstream_policy WHERE resourceId=? AND merchantId=?',
            )
              .bind(resource, merchant)
              .first()
          },
          (_url, init) => fetch(`${env.MOCK_ORIGIN}/upstream`, init),
        ),
    })
    return await gateway(request)
  } catch (error) {
    return reply(error instanceof GatewayError ? error.status : 503, {
      error: error instanceof GatewayError ? error.code : 'fixture_unavailable',
      localSimulationOnly: true,
    })
  }
}

function pilotAuthority(
  db: D1Database,
  id: string,
  env: Env,
): LocalPilotAuthority {
  return {
    async read() {
      const row = await db
        .prepare(
          'SELECT admission,revoked FROM sg07_internal_pilot_fixture WHERE id=?',
        )
        .bind(id)
        .first<{ admission: string; revoked: number }>()
      return row
        ? { manifest: boundedJson(row.admission), revoked: row.revoked }
        : null
    },
    verifySettlement: localChainVerifier(env.MOCK_ORIGIN, () =>
      trustedClock(env),
    ),
  }
}
