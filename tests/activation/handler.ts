import {
  currentResource,
  persistEvidence,
} from '../../server/payments/authority'
import { ActivationStore } from '../../server/payments/store'
import { handlePaymentRoute } from '../../server/payments/route'
import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { createCdpTransport } from '../../server/payments/facilitator'
import { paymentConfig } from '../../server/payments/config'
import { encodeFunctionData, encodeFunctionResult, type Hex } from 'viem'
import { createPaymentGateway } from '../../server/payments/gateway'
import { deployment } from '../../server/registry/status'
import { registryAbi } from '../../server/sg07/registry'
import { resourceId, commitment, USDC } from '../../server/sg05/registry'
import { readJson } from '../../server/sg03/http'
import type { FacilitatorClient } from '@x402/core/server'
import type { RegistryRpc } from '../../server/sg07/registry'
const nativeFetch = fetch
const owner = '0x00000000000000000000000000000000000a11ce',
  zero = '0x0000000000000000000000000000000000000000'
const salt = '0x' + '11'.repeat(32)
let blocked = 0
// This entire module is outside production Functions; all external I/O is denied.
globalThis.fetch = async () => {
  blocked++
  throw Error('LOCAL fixture denies external egress')
}
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
    env.ACTIVATION_LOCAL_ONLY !== 'yes' ||
    url.origin !== env.APP_ORIGIN ||
    url.hostname !== '127.0.0.1' ||
    (await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db'
  )
    return new Response('Disabled', { status: 404 })
  const mock = new URL(String(env.MOCK_ORIGIN))
  if (
    mock.protocol !== 'http:' ||
    mock.hostname !== '127.0.0.1' ||
    !mock.port ||
    mock.origin !== String(env.MOCK_ORIGIN)
  )
    throw Error('Local mock required')
  let observedTime = 0
  const call = async (path: string, body: unknown) => {
    const r = await nativeFetch(mock.origin + path, {
      method: 'POST',
      redirect: 'manual',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
    if (!r.ok) throw Error('LOCAL provider unavailable')
    const result = (await r.json()) as Record<string, unknown>
    if (Number.isSafeInteger(result.now))
      observedTime = Math.max(observedTime, Number(result.now))
    return result
  }
  if (url.pathname === '/activation/control') {
    if (
      request.method !== 'POST' ||
      request.headers.get('Origin') !== env.APP_ORIGIN ||
      request.headers.get('X-Local-Only') !== 'yes'
    )
      return new Response('Disabled', { status: 404 })
    const body = (await readJson(request)) as {
      action: string
      id?: string
      mode?: string
      nonce?: string
      testJwtKey?: string
    }

    if (body.action === 'enabledRoute' || body.action === 'missingMigration') {
      if (body.action === 'missingMigration')
        await db
          .prepare(
            'ALTER TABLE payment_manifests RENAME TO local_hidden_manifest',
          )
          .run()
      try {
        const r = await handlePaymentRoute(
          new Request('https://gate.signalarc.fun/api/pay/' + body.id),
          {
            ...env,
            X402_PAYMENTS_ENABLED: 'true',
            X402_EMERGENCY_DISABLED: 'false',
            X402_POLICY_ID: 'base-finalized-internal-json-v1',
            APP_ORIGIN: 'https://gate.signalarc.fun',
            REGISTRY_RPC_URL:
              'https://base-mainnet.g.alchemy.com/v2/LOCAL_NOT_A_CREDENTIAL',
            CDP_API_KEY_ID: 'LOCAL_NOT_A_CREDENTIAL',
            CDP_API_KEY_SECRET: 'LOCAL_NOT_A_CREDENTIAL',
          },
        )
        return Response.json({
          status: r.status,
          result: await r.json(),
          blocked,
        })
      } finally {
        if (body.action === 'missingMigration')
          await db
            .prepare(
              'ALTER TABLE local_hidden_manifest RENAME TO payment_manifests',
            )
            .run()
      }
    }
    if (body.action === 'ledger') {
      const id = 'LOCAL-ledger-' + body.id,
        at = Number((await call('/state', {})).now),
        hash = '0x' + '22'.repeat(32),
        next = '0x' + '33'.repeat(32)
      const rpc: RegistryRpc = async () => ({ number: '0x64', hash }),
        clock = async () => at
      const entry = (number: string, blockHash: string) => ({
        identity: { localSimulationOnly: true, resource: body.id },
        finalizedNumber: number,
        finalizedHash: blockHash,
        details: { localSimulationOnly: true },
      })
      await persistEvidence(
        db,
        'registry',
        id,
        'local_simulation',
        entry('100', hash),
        rpc,
        clock,
      )
      await persistEvidence(
        db,
        'registry',
        id,
        'local_simulation',
        entry('101', next),
        rpc,
        clock,
      )
      let conflict = false,
        replay = false,
        permanent = false
      try {
        await persistEvidence(
          db,
          'registry',
          id,
          'local_simulation',
          entry('101', '0x' + '44'.repeat(32)),
          rpc,
          clock,
        )
      } catch {
        conflict = true
      }
      try {
        await persistEvidence(
          db,
          'registry',
          id,
          'local_simulation',
          entry('100', hash),
          rpc,
          clock,
        )
      } catch {
        replay = true
      }
      try {
        await db
          .prepare('DELETE FROM payment_quarantine WHERE scope_id=?')
          .bind(id)
          .run()
      } catch {
        permanent = true
      }
      return Response.json({
        conflict,
        replay,
        permanent,
        entries: (
          await db
            .prepare(
              'SELECT finalized_number FROM payment_chain_evidence WHERE scope_id=? ORDER BY CAST(finalized_number AS INTEGER)',
            )
            .bind(id)
            .all()
        ).results,
        quarantine: await db
          .prepare('SELECT reason FROM payment_quarantine WHERE scope_id=?')
          .bind(id)
          .first(),
      })
    }
    if (body.action === 'jwt') {
      // Unfunded ephemeral authentication fixture, unrelated to any CDP account.
      try {
        const token = await generateJwt({
          apiKeyId: 'LOCAL_SIMULATION_NOT_A_CDP_ACCOUNT',
          apiKeySecret: body.testJwtKey!,
          requestMethod: 'POST',
          requestHost: 'api.cdp.coinbase.com',
          requestPath: '/platform/v2/x402/settle',
          expiresIn: 60,
        })
        const [h, p, s] = token.split('.'),
          header = JSON.parse(
            atob(h.replaceAll('-', '+').replaceAll('_', '/')),
          ),
          claims = JSON.parse(atob(p.replaceAll('-', '+').replaceAll('_', '/')))
        const raw = Uint8Array.from(atob(body.testJwtKey!), (c) =>
            c.charCodeAt(0),
          ),
          key = await crypto.subtle.importKey(
            'raw',
            raw.slice(32),
            { name: 'Ed25519' },
            false,
            ['verify'],
          )
        const verified = await crypto.subtle.verify(
          'Ed25519',
          key,
          Uint8Array.from(
            atob(s.replaceAll('-', '+').replaceAll('_', '/')),
            (c) => c.charCodeAt(0),
          ),
          new TextEncoder().encode(h + '.' + p),
        )
        return Response.json({
          verified,
          algorithm: header.alg,
          audience: claims.uris,
          ttl: claims.exp - claims.iat,
        })
      } catch {
        return Response.json({ verified: false })
      }
    }
    if (body.action === 'transport') {
      let captured: RequestInit | undefined,
        audience = '',
        calls = 0
      const client = createCdpTransport({} as never, {
        jwt: async (options) => {
          audience = String(options.requestHost) + String(options.requestPath)
          return 'LOCAL_SIMULATION_NOT_A_CREDENTIAL'
        },
        transport: async (_input, init) => {
          captured = init
          calls++
          return new Response(body.mode === 'malformed' ? 'x' : '{}', {
            status:
              body.mode === 'redirect' ? 302 : body.mode === 'http' ? 503 : 200,
            headers: { 'Content-Type': 'application/json' },
          })
        },
      })
      let rejected = false
      try {
        await client.getSupported()
      } catch {
        rejected = true
      }
      return Response.json({
        rejected,
        calls,
        manual: captured?.redirect === 'manual',
        audience,
        cache: captured?.cache,
      })
    }
    if (body.action === 'config') {
      let refused = false
      try {
        paymentConfig(
          new Request('https://gate.signalarc.fun/api/pay/' + body.id),
          {
            ...env,
            X402_PAYMENTS_ENABLED: 'true',
            X402_EMERGENCY_DISABLED:
              body.mode === 'emergency' ? 'true' : 'false',
            X402_POLICY_ID: 'base-finalized-internal-json-v1',
            APP_ORIGIN: 'https://gate.signalarc.fun',
            REGISTRY_RPC_URL:
              'https://base-mainnet.g.alchemy.com/v2/LOCAL_NOT_A_CREDENTIAL',
            CDP_API_KEY_ID:
              body.mode === 'credentials' ? '' : 'LOCAL_NOT_A_CREDENTIAL',
            CDP_API_KEY_SECRET: 'LOCAL_NOT_A_CREDENTIAL',
          },
        )
      } catch {
        refused = true
      }
      return Response.json({ refused })
    }

    if (body.action === 'seed') {
      const id = crypto.randomUUID(),
        merchant = crypto.randomUUID(),
        now = Number((await call('/state', {})).now),
        onchain = resourceId(owner, id),
        config = commitment(onchain, 'https://api.example.com/data', 4096, salt)
      await db
        .prepare(
          'INSERT INTO merchants VALUES(?,?,?,?) ON CONFLICT(wallet_address) DO NOTHING',
        )
        .bind(merchant, owner, now, now)
        .run()
      const m = await db
        .prepare('SELECT id FROM merchants WHERE wallet_address=?')
        .bind(owner)
        .first<{ id: string }>()
      await db
        .prepare(
          'INSERT INTO api_resources(id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          id,
          m!.id,
          'LOCAL SIMULATION ONLY',
          'https://api.example.com/data',
          '{"type":"json","maxBytes":4096,"redirects":"error"}',
          '1000',
          owner,
          'eip155:8453',
          1,
          now,
          now,
        )
        .run()
      await db
        .prepare(
          'INSERT INTO resource_registry_bindings(resource_id,original_owner,onchain_resource_id,config_salt,config_hash,registry_version,source,checked_at,registry_address) VALUES(?,?,?,?,?,?,?, ?,?)',
        )
        .bind(
          id,
          owner,
          onchain,
          salt,
          config,
          '1',
          'unconfirmed',
          now,
          deployment.address,
        )
        .run()
      const r = await db
          .prepare('SELECT payment_revision FROM api_resources WHERE id=?')
          .bind(id)
          .first<{ payment_revision: number }>(),
        b = await db
          .prepare(
            'SELECT generation FROM resource_registry_bindings WHERE resource_id=?',
          )
          .bind(id)
          .first<{ generation: number }>()
      await db
        .prepare(
          `INSERT INTO payment_manifests VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          id,
          m!.id,
          'base-finalized-internal-json-v1',
          'signalarc.resource-configuration.v1',
          'local_simulation',
          owner,
          owner,
          onchain,
          deployment.address,
          deployment.runtimeCodeHash,
          config,
          '1',
          r!.payment_revision,
          b!.generation,
          '1000',
          owner,
          now,
          now + 86400000,
          null,
        )
        .run()
      return Response.json({ id, localSimulationOnly: true })
    }
    if (body.action === 'inspect')
      return Response.json({
        resource: await db
          .prepare('SELECT * FROM api_resources WHERE id=?')
          .bind(body.id)
          .first(),
        binding: await db
          .prepare(
            'SELECT * FROM resource_registry_bindings WHERE resource_id=?',
          )
          .bind(body.id)
          .first(),
        merchant: await db
          .prepare(
            'SELECT m.* FROM merchants m JOIN api_resources r ON r.merchant_id=m.id WHERE r.id=?',
          )
          .bind(body.id)
          .first(),
        attempts: (
          await db
            .prepare('SELECT * FROM payment_attempts WHERE resource_id=?')
            .bind(body.id)
            .all()
        ).results,
        analytics: (
          await db
            .prepare(
              'SELECT event_type,evidence_kind FROM analytics_events WHERE resource_id=?',
            )
            .bind(body.id)
            .all()
        ).results,
        receipts: (
          await db
            .prepare(
              'SELECT p.* FROM payment_receipts p JOIN payment_attempts a ON a.id=p.attempt_id WHERE a.resource_id=?',
            )
            .bind(body.id)
            .all()
        ).results,
        manifest: await db
          .prepare('SELECT * FROM payment_manifests WHERE resource_id=?')
          .bind(body.id)
          .first(),
        evidence: (
          await db.prepare('SELECT * FROM payment_chain_evidence').all()
        ).results,
        quarantine: (await db.prepare('SELECT * FROM payment_quarantine').all())
          .results,
        blocked,
      })
    if (body.action === 'revoke')
      await db
        .prepare(
          'UPDATE payment_manifests SET revoked_at=? WHERE resource_id=?',
        )
        .bind(Number((await call('/state', {})).now), body.id)
        .run()
    if (body.action === 'edit')
      await db
        .prepare(
          "UPDATE api_resources SET price_atomic='1001',updated_at=? WHERE id=?",
        )
        .bind(Number((await call('/state', {})).now), body.id)
        .run()
    if (body.action === 'expire')
      await db
        .prepare(
          "UPDATE payment_attempts SET operation_deadline=1 WHERE resource_id=? AND phase='settlement_pending'",
        )
        .bind(body.id)
        .run()
    if (body.action === 'deliveryRace') {
      const clock = async () => Number((await call('/state', {})).now),
        store = new ActivationStore(db, 'local_simulation', clock),
        row = await db
          .prepare('SELECT id FROM payment_attempts WHERE resource_id=?')
          .bind(body.id)
          .first<{ id: string }>(),
        first = (await store.get(row!.id))!,
        s = await currentResource(db, body.id!, 'local_simulation', clock)
      const claimed = await store.fulfillment(first, s)
      await store.advance(
        first.id,
        'fulfilling',
        'fulfillment_failed',
        'LOCAL known failure',
      )
      const second = (await store.get(first.id))!,
        reclaimed = await store.fulfillment(second, s),
        staleFinish = await store.fulfillment(first, s, true),
        staleFailure = await store.deliveryFailed(first),
        finished = await store.fulfillment(second, s, true)
      return Response.json({
        claimed,
        reclaimed,
        staleFinish,
        staleFailure,
        finished,
        attempt: await store.get(first.id),
      })
    }
    if (body.action === 'permitReplay') {
      const store = new ActivationStore(db, 'local_simulation', async () =>
          Number((await call('/state', {})).now),
        ),
        a = await db
          .prepare('SELECT id FROM payment_attempts WHERE resource_id=?')
          .bind(body.id)
          .first<{ id: string }>()
      return Response.json({
        permitted: await store.submissionPermit((await store.get(a!.id))!),
      })
    }
    if (body.action === 'failure')
      await db
        .prepare(
          "CREATE TRIGGER activation_fail_receipt BEFORE INSERT ON payment_receipts BEGIN SELECT RAISE(ABORT,'LOCAL_FAULT'); END",
        )
        .run()
    if (body.action === 'repair')
      await db.prepare('DROP TRIGGER activation_fail_receipt').run()
    if (body.action === 'quarantine')
      await db
        .prepare(
          "INSERT INTO payment_quarantine VALUES('settlement',?,'LOCAL conflict',?)",
        )
        .bind(body.id, Number((await call('/state', {})).now))
        .run()
    return Response.json({ localSimulationOnly: true })
  }
  const rpc: RegistryRpc = async (method, params) => {
    const state = await call('/state', {})
    const block = (number: string, hash: string) => ({
      number,
      hash,
      timestamp: String(state.headTimestamp),
    })
    const f = state.chain as
      | {
          finalized?: unknown
          canonical?: unknown
          receipt?: unknown
          tx?: unknown
          state?: unknown
        }
      | undefined
    if (state.mode === 'rpc-error') throw Error('LOCAL RPC error')
    if (method === 'eth_chainId')
      return state.mode === 'wrong-chain' ? '0x1' : '0x2105'
    if (method === 'eth_getCode') return state.code
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'latest' || params[0] === '0x68')
        return block('0x68', '0x' + '44'.repeat(32))
      if (params[0] === 'finalized')
        return state.mode === 'not-final'
          ? block('0x63', '0x' + '55'.repeat(32))
          : (f?.finalized ?? block('0x66', '0x' + '66'.repeat(32)))
      if (params[0] === '0x64') return f?.canonical
      if (params[0] === '0x66')
        return state.mode === 'reorg'
          ? block('0x66', '0x' + '99'.repeat(32))
          : (f?.finalized ?? block('0x66', '0x' + '66'.repeat(32)))
    }
    if (method === 'eth_getTransactionReceipt') {
      if (
        state.mode === 'delivery-error' &&
        (await db
          .prepare("SELECT 1 FROM payment_attempts WHERE phase='fulfilling'")
          .first())
      )
        throw Error('LOCAL delivery observation fault')
      return f?.receipt
    }
    if (method === 'eth_getTransactionByHash') return f?.tx
    if (method === 'eth_call') {
      const tx = params[0] as { to: string; data: Hex }
      if (tx.to.toLowerCase() === USDC.toLowerCase()) return f?.state
      if (
        tx.data ===
        encodeFunctionData({ abi: registryAbi, functionName: 'CHAIN_ID' })
      )
        return encodeFunctionResult({
          abi: registryAbi,
          functionName: 'CHAIN_ID',
          result: 8453n,
        })
      const rows = (await db.prepare('SELECT * FROM payment_manifests').all())
        .results
      const m = rows.find(
        (r) =>
          encodeFunctionData({
            abi: registryAbi,
            functionName: 'getResource',
            args: [r.onchain_resource_id as Hex],
          }) === tx.data,
      )!
      return encodeFunctionResult({
        abi: registryAbi,
        functionName: 'getResource',
        result: {
          owner: owner,
          payout: owner,
          priceAtomic: state.mode === 'wrong-price' ? 1001n : 1000n,
          version: 1n,
          enabled: state.mode !== 'disabled',
          configHash: m.config_hash as Hex,
          pendingOwner: zero,
        },
      })
    }
    throw Error('LOCAL RPC method not permitted')
  }
  const facilitator: FacilitatorClient = {
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
      extensions: ['builder-code'],
      signers: {},
    }),
    verify: async (p, r) => {
      const state = await call('/state', {}),
        result = await call('/verify', { p, r })
      if (state.mode === 'expires-on-verify')
        await db
          .prepare(
            "UPDATE payment_attempts SET operation_deadline=1 WHERE phase='verifying'",
          )
          .run()
      return result as never
    },
    settle: async (p, r) => {
      const state = await call('/state', {})
      const result = await call('/settle', { p, r })
      if (state.mode === 'revoke-on-settle')
        await db
          .prepare(
            'UPDATE payment_manifests SET revoked_at=? WHERE resource_id=?',
          )
          .bind(
            Number(state.now),
            new URL(p.resource!.url).pathname.split('/').at(-1),
          )
          .run()
      return result as never
    },
  }
  const canonical = new URL(request.url)
  canonical.pathname = canonical.pathname.replace(
    '/activation/pay/',
    '/api/pay/',
  )
  await call('/state', {})
  const clock = async () => observedTime
  return createPaymentGateway({
    db,
    realm: 'local_simulation',
    origin: url.origin,
    rpc,
    facilitator,
    clock,
  })(new Request(canonical, request))
}
