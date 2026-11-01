import { httpsUpstream, resourceInput } from '../../shared/resources'
import { protectedJson } from '../../server/sg05/upstream'
import { GatewayError, reply } from '../../server/sg05/bounds'
import {
  commitment,
  resourceId,
  type Snapshot,
} from '../../server/sg05/registry'
import {
  productionUpstream,
  createLocalUpstreamAccess,
} from '../../server/sg07/upstream'
import { readJson } from '../../server/sg03/http'
let blockedEgress = 0
globalThis.fetch = async () => {
  blockedEgress++
  throw Error('Isolated upstream tests forbid all network egress')
}
const uuid = '8dc286d7-8b04-4411-96a0-422aad965f31',
  merchant = '00000000-0000-4000-8000-000000000002'
const owner = '0x00000000000000000000000000000000000a11ce',
  fixedUrl = 'https://api.example.com/v1/local-json',
  salt = '0x' + '11'.repeat(32)
function fixtureSnapshot(url: string): Snapshot {
  const resource = resourceInput({
    name: 'LOCAL SIMULATION ONLY',
    upstreamUrl: url,
    priceAtomic: '1000',
    payoutAddress: owner,
    responseConfig: { type: 'json', maxBytes: 4096, redirects: 'error' },
    network: 'eip155:8453',
    enabled: true,
  })
  const onchain = resourceId(owner, uuid)
  return {
    id: uuid,
    merchantId: merchant,
    owner,
    revision: 1,
    resource,
    hash: 'local_transport_fixture',
    binding: {
      original_owner: owner,
      onchain_resource_id: onchain,
      registry_address: null,
      config_salt: salt,
      config_hash: commitment(onchain, resource.upstreamUrl, 4096, salt),
      registry_version: '1',
      source: 'local_simulation',
      checked_at: Date.now(),
      generation: 1,
    },
  }
}
export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Record<string, unknown> & { SIGNALARC_DB: D1Database }
}) {
  if (
    env.UPSTREAM_SECURITY_LOCAL_ONLY !== 'yes' ||
    env.APP_ENV !== 'local' ||
    new URL(request.url).hostname !== '127.0.0.1' ||
    new URL(request.url).origin !== env.APP_ORIGIN ||
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes' ||
    (await env.SIGNALARC_DB.prepare('SELECT 1').all()).meta.served_by !==
      'miniflare.db'
  )
    return new Response('Local transport fixture unavailable', { status: 404 })
  const body = (await readJson(request)) as {
    action: string
    mode: string
    url?: string
  }
  let calls = 0,
    cancelled = 0,
    now = 1000000,
    clockCalls = 0
  const clock = async () => {
    clockCalls++
    if (body.mode === 'final-clock-hang' && clockCalls > 1)
      return new Promise<number>(() => {})
    return now
  }
  if (body.action === 'url') {
    try {
      return reply(200, {
        localSimulationOnly: true,
        url: httpsUpstream(body.url),
        calls,
      })
    } catch {
      return reply(422, { rejected: true, calls })
    }
  }
  if (body.action === 'egress') {
    const before = blockedEgress
    try {
      await fetch('https://example.invalid')
    } catch {
      /* stub must reject before network */
    }
    return reply(200, {
      blocked: blockedEgress - before,
      localSimulationOnly: true,
    })
  }
  try {
    const s = fixtureSnapshot(body.url ?? fixedUrl)
    const access = createLocalUpstreamAccess(
      async () =>
        body.mode === 'missing-entry'
          ? null
          : {
              resourceId:
                body.mode === 'wrong-resource'
                  ? '00000000-0000-4000-8000-000000000099'
                  : uuid,
              merchantId:
                body.mode === 'wrong-merchant'
                  ? '00000000-0000-4000-8000-000000000099'
                  : merchant,
              url: fixedUrl,
            },
      async (url, init) => {
        calls++
        if (
          url !== fixedUrl ||
          init.method !== 'GET' ||
          init.redirect !== 'manual' ||
          init.cache !== 'no-store' ||
          init.body !== undefined ||
          JSON.stringify([...new Headers(init.headers)]) !==
            JSON.stringify([['accept', 'application/json']])
        )
          throw Error('Unsafe outbound request construction')
        if (body.mode === 'header-timeout')
          return new Promise<Response>(() => {})
        if (body.mode === 'late-header') now += 1001
        if (body.mode === 'clock-rollback') now -= 1001
        const headers = new Headers({ 'Content-Type': 'application/json' })
        if (body.mode === 'content-type')
          headers.set('Content-Type', 'text/html')
        if (body.mode === 'charset')
          headers.set('Content-Type', 'application/json; charset=utf-16')
        if (body.mode === 'encoding') headers.set('Content-Encoding', 'gzip')
        if (body.mode === 'large-header')
          headers.set('X-Test-Only', 'x'.repeat(16385))
        if (body.mode === 'bad-length') headers.set('Content-Length', '-1')
        if (body.mode === 'declared-large')
          headers.set('Content-Length', '5000')
        if (body.mode === 'redirect')
          return new Response(null, {
            status: 302,
            headers: { Location: 'http://169.254.169.254/latest/meta-data/' },
          })
        if (body.mode === 'partial')
          return new Response('{}', { status: 206, headers })
        if (body.mode === 'invalid-json') return new Response('{', { headers })
        if (body.mode === 'depth')
          return new Response('['.repeat(9) + '0' + ']'.repeat(9), { headers })
        if (body.mode === 'collection')
          return Response.json(Array.from({ length: 65 }, () => 1))
        if (body.mode === 'bad-utf8')
          return new Response(new Uint8Array([0xff]), { headers })
        if (body.mode === 'large')
          return new Response(JSON.stringify({ v: 'x'.repeat(4097) }), {
            headers,
          })
        if (body.mode === 'slow-stream')
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{'))
              },
              cancel() {
                cancelled++
              },
            }),
            { headers },
          )
        if (body.mode === 'late-body')
          return new Response(
            new ReadableStream({
              start(c) {
                c.enqueue(new TextEncoder().encode('{}'))
                now += 1001
                c.close()
              },
              cancel() {
                cancelled++
              },
            }),
            { headers },
          )
        return new Response(
          new ReadableStream({
            start(c) {
              c.enqueue(
                new TextEncoder().encode('{"localSimulationOnly":true}'),
              )
              c.close()
            },
            cancel() {
              cancelled++
            },
          }),
          { headers },
        )
      },
    )
    if (body.action === 'dns-policy') {
      // A public DNS answer could change to private, or an alias could end there. This is only a model.
      await access.assertEligible(s)
      const scenario =
        body.mode === 'cname'
          ? 'public.example.com -> alias.example.com -> 169.254.169.254'
          : 'public address at pre-check -> 127.0.0.1 at hypothetical connection'
      try {
        productionUpstream(s.resource.upstreamUrl)
      } catch {
        return reply(503, {
          error: 'connection_safe_transport_unavailable',
          scenario,
          policyOnly: true,
          calls,
        })
      }
    }
    const value = await protectedJson(s, access, clock)
    return reply(200, { localSimulationOnly: true, value, calls, cancelled })
  } catch (error) {
    return reply(error instanceof GatewayError ? error.status : 503, {
      error: error instanceof GatewayError ? error.code : 'upstream_rejected',
      calls,
      cancelled,
      localSimulationOnly: true,
    })
  }
}
