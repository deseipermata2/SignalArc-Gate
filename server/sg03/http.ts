import { ConfigurationError, readFoundationConfig } from '../config'
import { ValidationError } from '../../shared/resources'

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message)
  }
}
export function apiConfig(request: Request, env: Record<string, unknown>) {
  const foundation = readFoundationConfig(env)
  if (typeof env.APP_ORIGIN !== 'string')
    throw new ConfigurationError('Missing required configuration: APP_ORIGIN')
  let origin: URL
  try {
    origin = new URL(env.APP_ORIGIN)
  } catch {
    throw new ConfigurationError('Invalid APP_ORIGIN configuration')
  }
  const local =
    env.APP_ENV === 'local' &&
    ['127.0.0.1', 'localhost'].includes(origin.hostname)
  if (
    origin.origin !== env.APP_ORIGIN ||
    origin.username ||
    origin.password ||
    (origin.protocol !== 'https:' && !(local && origin.protocol === 'http:'))
  )
    throw new ConfigurationError(
      'APP_ORIGIN must be an exact HTTPS origin, or explicit loopback local HTTP',
    )
  if (new URL(request.url).origin !== origin.origin)
    throw new HttpError(403, 'Unexpected request origin')
  if (request.headers.get('Sec-Fetch-Site') === 'cross-site')
    throw new HttpError(403, 'Cross-site requests are forbidden')
  return {
    ...foundation,
    origin: origin.origin,
    domain: origin.host,
    secure: origin.protocol === 'https:',
    cookieName:
      local && origin.protocol === 'http:' ? 'sg_session' : '__Host-sg_session',
    challengeName:
      local && origin.protocol === 'http:'
        ? 'sg_challenge'
        : '__Host-sg_challenge',
  }
}
export type ApiConfig = ReturnType<typeof apiConfig>
export function requireCsrf(request: Request, config: ApiConfig) {
  if (
    request.headers.get('Origin') !== config.origin ||
    request.headers.get('X-SignalArc-Request') !== '1'
  )
    throw new HttpError(403, 'Same-origin request header required')
  if (
    request.headers.get('Content-Type')?.split(';')[0].trim() !==
    'application/json'
  )
    throw new HttpError(415, 'Content-Type must be application/json')
}
export function json(value: unknown, status = 200, cookies: string[] = []) {
  const headers = new Headers({
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Content-Type': 'application/json',
  })
  for (const cookie of cookies) headers.append('Set-Cookie', cookie)
  return new Response(JSON.stringify(value), { status, headers })
}
export function cookie(
  name: string,
  value: string,
  seconds: number,
  secure: boolean,
) {
  return `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`
}
export function readCookie(request: Request, name: string) {
  const entries = (request.headers.get('Cookie') ?? '')
    .split(';')
    .map((part) => part.trim())
    .filter((part) => part.startsWith(`${name}=`))
  if (entries.length !== 1) return undefined
  const value = entries[0].slice(name.length + 1)
  return /^[a-f0-9]{64}$/.test(value) ? value : undefined
}
export function randomToken() {
  return Array.from(crypto.getRandomValues(new Uint8Array(32)), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
export async function hash(value: string) {
  const bytes = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(value),
  )
  return Array.from(new Uint8Array(bytes), (byte) =>
    byte.toString(16).padStart(2, '0'),
  ).join('')
}
export async function readJson(request: Request) {
  const maxBytes = 16384
  if (Number(request.headers.get('Content-Length') ?? '0') > maxBytes)
    throw new HttpError(413, 'Request body exceeds 16 KiB')
  if (!request.body) throw new HttpError(400, 'JSON body required')
  const reader = request.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  try {
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      size += value.byteLength
      if (size > maxBytes) {
        await reader.cancel()
        throw new HttpError(413, 'Request body exceeds 16 KiB')
      }
      chunks.push(value)
    }
  } finally {
    reader.releaseLock()
  }
  const bytes = new Uint8Array(size)
  let offset = 0
  for (const chunk of chunks) {
    bytes.set(chunk, offset)
    offset += chunk.length
  }
  try {
    const text = new TextDecoder('utf-8', {
      fatal: true,
      ignoreBOM: false,
    }).decode(bytes)
    let depth = 0,
      quoted = false,
      escaped = false
    for (const char of text) {
      if (quoted) {
        if (escaped) escaped = false
        else if (char === '\\') escaped = true
        else if (char === '"') quoted = false
      } else if (char === '"') quoted = true
      else if (char === '{' || char === '[') {
        if (++depth > 8) throw new HttpError(413, 'JSON nesting exceeds limit')
      } else if (char === '}' || char === ']') depth--
    }
    return JSON.parse(text) as unknown
  } catch (error) {
    if (error instanceof HttpError) throw error
    throw new HttpError(400, 'Malformed JSON body')
  }
}
export function apiError(error: unknown) {
  if (error instanceof HttpError)
    return json({ error: error.message }, error.status)
  if (error instanceof ValidationError)
    return json({ error: error.message }, 422)
  if (error instanceof ConfigurationError)
    return json({ error: error.message }, 503)
  // Do not log bodies, cookies, signatures or database errors containing bound values.
  return json(
    {
      error:
        'Service unavailable; ensure the SG-03 local migration has been applied',
    },
    503,
  )
}
