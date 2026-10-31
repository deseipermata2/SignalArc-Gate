export class GatewayError extends Error {
  constructor(
    public status: number,
    public code: string,
  ) {
    super(code)
  }
}
export function canonical(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`
  if (value !== null && typeof value === 'object')
    return `{${Object.entries(value)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
      .map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
export function boundedJson(
  text: string,
  maxBytes = 8192,
  maxString = 2048,
): unknown {
  if (new TextEncoder().encode(text).length > maxBytes)
    throw new GatewayError(413, 'json_size_limit')
  let depth = 0,
    quoted = false,
    escaped = false
  for (const c of text) {
    if (quoted) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') quoted = false
    } else if (c === '"') quoted = true
    else if (c === '{' || c === '[') {
      if (++depth > 8) throw new GatewayError(413, 'json_depth_limit')
    } else if (c === '}' || c === ']') depth--
  }
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    throw new GatewayError(400, 'malformed_json')
  }
  let nodes = 0
  function walk(item: unknown) {
    if (++nodes > 1024) throw new GatewayError(413, 'json_node_limit')
    if (typeof item === 'string' && item.length > maxString)
      throw new GatewayError(413, 'json_string_limit')
    if (item && typeof item === 'object') {
      const entries = Object.entries(item)
      if (entries.length > 64)
        throw new GatewayError(413, 'json_collection_limit')
      for (const [key, child] of entries) {
        if (key.length > 128) throw new GatewayError(413, 'json_key_limit')
        walk(child)
      }
    }
  }
  walk(value)
  return value
}
export async function boundedResponse(
  response: Response,
  maxBytes: number,
  signal?: AbortSignal,
  maxString = 4096,
) {
  if (
    response.headers.get('Content-Type')?.split(';')[0].trim().toLowerCase() !==
    'application/json'
  )
    throw new GatewayError(502, 'unexpected_content_type')
  if (Number(response.headers.get('Content-Length') ?? 0) > maxBytes)
    throw new GatewayError(502, 'response_size_limit')
  if (!response.body) throw new GatewayError(502, 'empty_response')
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let bytes = 0
  const cancel = () => {
    void reader.cancel().catch(() => {})
  }
  signal?.addEventListener('abort', cancel, { once: true })
  try {
    for (;;) {
      if (signal?.aborted) throw new GatewayError(504, 'transport_timeout')
      const { value, done } = await reader.read()
      if (done) break
      bytes += value.byteLength
      if (bytes > maxBytes) throw new GatewayError(502, 'response_size_limit')
      chunks.push(value)
    }
    if (signal?.aborted) throw new GatewayError(504, 'transport_timeout')
    const data = new Uint8Array(bytes)
    let offset = 0
    for (const chunk of chunks) {
      data.set(chunk, offset)
      offset += chunk.length
    }
    return boundedJson(
      new TextDecoder('utf-8', { fatal: true, ignoreBOM: false }).decode(data),
      maxBytes,
      maxString,
    )
  } finally {
    signal?.removeEventListener('abort', cancel)
    await reader.cancel().catch(() => {})
    reader.releaseLock()
  }
}
export function deadline<T>(
  run: (signal: AbortSignal) => Promise<T>,
  ms = 1000,
): Promise<T> {
  const abort = new AbortController()
  let timer: ReturnType<typeof setTimeout>
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => {
      abort.abort()
      reject(new GatewayError(504, 'transport_timeout'))
    }, ms)
  })
  return Promise.race([run(abort.signal), timeout]).finally(() =>
    clearTimeout(timer),
  )
}
export function reply(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      Vary: 'PAYMENT-SIGNATURE',
      'X-Content-Type-Options': 'nosniff',
      'X-SignalArc-Mode': 'LOCAL SIMULATION ONLY',
      ...headers,
    },
  })
}
