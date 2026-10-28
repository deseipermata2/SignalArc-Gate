import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import type { PaymentPayload } from '@x402/core/types'
import { PaymentPayloadSchema } from '@x402/core/schemas'
import { decodePaymentSignatureHeader, encodePaymentRequiredHeader } from '@x402/core/http'

type LocalEnv = { SG02A_LOCAL_ONLY?: string; MOCK_ORIGIN?: string; CF_PAGES_URL?: string }
const network = 'eip155:8453'
const maxPaymentHeader = 8192

// Bound work before SDK/Zod parsing. These controls mitigate, but do not fix, the advisory.
function checkPaymentBounds(header: string): void {
  const text = atob(header)
  let depth = 0
  let quoted = false
  let escaped = false
  for (const char of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (char === '\\') escaped = true
      else if (char === '"') quoted = false
    } else if (char === '"') quoted = true
    else if (char === '{' || char === '[') {
      if (++depth > 16) throw new RangeError('Payment nesting limit')
    } else if (char === '}' || char === ']') depth--
  }
}

function checkCollectionBounds(value: unknown): void {
  let nodes = 0
  function visit(item: unknown): void {
    if (++nodes > 256) throw new RangeError('Payment node limit')
    if (typeof item === 'string' && item.length > 2048) throw new RangeError('Payment string limit')
    if (Array.isArray(item)) {
      if (item.length > 32) throw new RangeError('Payment array limit')
      for (const child of item) visit(child)
    } else if (item !== null && typeof item === 'object') {
      const entries = Object.entries(item)
      if (entries.length > 32) throw new RangeError('Payment object limit')
      for (const [key, child] of entries) {
        if (key.length > 128) throw new RangeError('Payment key limit')
        visit(child)
      }
    }
  }
  visit(value)
}

/** Test fixture only. No production route imports this module. No paid resource exists. */
export async function handleCompatibility(request: Request, env: LocalEnv): Promise<Response> {
  const url = new URL(request.url)
  const deployedHost = env.CF_PAGES_URL ? new URL(env.CF_PAGES_URL).hostname : undefined
  if (env.SG02A_LOCAL_ONLY !== 'yes' || (deployedHost && deployedHost !== '127.0.0.1' && deployedHost !== 'localhost') || url.hostname !== '127.0.0.1') {
    return new Response('Local compatibility fixture disabled', { status: 404 })
  }
  const reject = (status: number, error: string) => Response.json({ localOnly: true, error }, { status, headers: { 'Cache-Control': 'no-store' } })
  if (request.method !== 'GET') return reject(405, 'method_not_allowed')
  if (request.url.length > 2048) return reject(414, 'url_too_large')
  const header = request.headers.get('PAYMENT-SIGNATURE')
  let decoded: unknown
  if (header) {
    if (header.length > maxPaymentHeader) return reject(413, 'payment_too_large')
    try {
      checkPaymentBounds(header)
      decoded = decodePaymentSignatureHeader(header)
      checkCollectionBounds(decoded)
    } catch (error) {
      if (error instanceof RangeError) return reject(413, 'payment_structure_too_large')
      // Malformed input still receives a normal 402 challenge, without verification.
    }
  }
  const origin = new URL(env.MOCK_ORIGIN ?? 'http://invalid.invalid')
  if (origin.protocol !== 'http:' || origin.hostname !== '127.0.0.1' || !origin.port || origin.pathname !== '/') {
    return new Response('Loopback mock required', { status: 503 })
  }
  // SDK uses global fetch. Fail closed before any outbound call, including defaults.
  // Each test project runs in its own isolate; this never patches the application.
  const originalFetch = globalThis.fetch
  globalThis.fetch = async (input, init) => {
    const target = new URL(input instanceof Request ? input.url : String(input))
    if (target.origin !== origin.origin || !['/supported', '/verify', '/settle'].includes(target.pathname)) {
      throw new Error('SG-02A blocked non-mock egress')
    }
    const response = await originalFetch(input, { ...init, redirect: 'manual' })
    if (response.status >= 300 && response.status < 400) throw new Error('SG-02A blocked redirect')
    return response
  }
  try {
    if (url.pathname === '/egress') {
      let blocked = false
      try { await fetch('https://example.invalid/verify') } catch { blocked = true }
      return Response.json({ localOnly: true, blocked })
    }
    if (url.pathname === '/modules') {
      let credentialGuard = false
      try {
        // Empty explicit arguments suppress process.env fallback. Never read secrets.
        await generateJwt({ apiKeyId: '', apiKeySecret: '', requestMethod: 'GET', requestHost: origin.host, requestPath: '/supported' })
      } catch (error) {
        credentialGuard = error instanceof Error && error.message === 'Key name is required'
      }
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode('SG-02A'))
      let cdpCredentialGuard = false
      try {
        createCdpFacilitatorClient({ apiKeyId: '', apiKeySecret: '', baseUrl: origin.origin })
      } catch (error) {
        cdpCredentialGuard = error instanceof Error && error.message.includes('Missing required CDP credentials')
      }
      return Response.json({ localOnly: true, credentialGuard, webCryptoBytes: digest.byteLength,
        cdpHelperAvailable: typeof createCdpFacilitatorClient === 'function', cdpCredentialGuard, networks: [network] })
    }
    const client = new HTTPFacilitatorClient({ url: origin.origin, timeoutMs: 2000 })
    const server = new x402ResourceServer(client).register(network, new ExactEvmScheme())
    await server.initialize()
    const requirements = await server.buildPaymentRequirements({
      scheme: 'exact', network, price: '$0.001',
      // Burn address is a local-only sentinel, never a merchant or payment destination.
      payTo: '0x000000000000000000000000000000000000dEaD', maxTimeoutSeconds: 60,
    })
    const resource = { url: `${url.origin}/challenge`, description: 'SG-02A LOCAL ONLY — never pay', mimeType: 'application/json' }
    const challenge = await server.createPaymentRequiredResponse(requirements, resource)
    let reason = 'payment_required'
    if (header) {
      try {
        const parsed = PaymentPayloadSchema.safeParse(decoded)
        if (!parsed.success || parsed.data.x402Version !== 2 || parsed.data.accepted.network !== network) throw new Error('Malformed payload')
        // Schema types are wider than the server types (network string and nullable extras).
        const payload: PaymentPayload = { ...parsed.data, extensions: parsed.data.extensions ?? undefined,
          accepted: { ...parsed.data.accepted, network, extra: parsed.data.accepted.extra ?? {} } }
        const matched = server.findMatchingRequirements(requirements, payload)
        if (!matched) throw new Error('Unmatched requirements')
        const result = url.pathname === '/settle-rejection'
          ? await client.settle(payload, matched)
          : await server.verifyPayment(payload, matched)
        // Even a positive mock verify cannot unlock content. No success response exists.
        reason = 'isValid' in result && result.isValid ? 'local_mock_cannot_authorize' : 'mock_rejected'
      } catch {
        reason = 'invalid_or_rejected_payment'
      }
    }
    return Response.json({ ...challenge, error: reason, localOnly: true }, {
      status: 402,
      headers: { 'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge), 'Cache-Control': 'no-store' },
    })
  } finally {
    globalThis.fetch = originalFetch
  }
}
