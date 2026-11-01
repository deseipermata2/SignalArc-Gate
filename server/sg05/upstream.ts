import { httpsUpstream } from '../../shared/resources'
import { boundedResponse, deadline, GatewayError } from './bounds'
import type { Snapshot } from './registry'
import { clockTime, type TrustedClock } from './clock'
/** No default fetch: a separately reviewed connection-safe transport is mandatory. */
export type JsonTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>
export interface UpstreamAccess {
  assertEligible(snapshot: Snapshot): void | Promise<void>
  request: JsonTransport
}
export async function protectedJson(
  s: Snapshot,
  access: UpstreamAccess,
  clock: TrustedClock,
) {
  return deadline(async (signal) => {
    const started = await clockTime(clock)
    const url = httpsUpstream(s.resource.upstreamUrl)
    await access.assertEligible(s)
    if (signal.aborted) throw new GatewayError(504, 'transport_timeout')
    const response = await access.request(url, {
      method: 'GET',
      redirect: 'manual',
      cache: 'no-store',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (response.status !== 200 || response.redirected) {
      void response.body?.cancel().catch(() => {})
      throw new GatewayError(502, 'upstream_unavailable_or_redirect')
    }
    let headerBytes = 0
    response.headers.forEach((value, key) => {
      headerBytes += new TextEncoder().encode(key + value).length
    })
    const length = response.headers.get('Content-Length')
    const contentType = response.headers.get('Content-Type')?.trim()
    if (
      headerBytes > 16384 ||
      (length !== null && !/^(?:0|[1-9]\d{0,6})$/.test(length))
    ) {
      void response.body?.cancel().catch(() => {})
      throw new GatewayError(502, 'upstream_header_limit')
    }
    if (
      length !== null &&
      Number(length) > s.resource.responseConfig.maxBytes
    ) {
      void response.body?.cancel().catch(() => {})
      throw new GatewayError(502, 'response_size_limit')
    }
    if (
      !contentType ||
      !/^application\/json(?:;\s*charset=utf-8)?$/i.test(contentType) ||
      !['', 'identity'].includes(
        response.headers.get('Content-Encoding')?.toLowerCase() ?? '',
      )
    ) {
      void response.body?.cancel().catch(() => {})
      throw new GatewayError(502, 'unexpected_content_type')
    }
    const value = await boundedResponse(
      response,
      s.resource.responseConfig.maxBytes,
      signal,
    )
    // Include parsing and the final clock read in the deadline. Never release a late body.
    const elapsed = (await clockTime(clock)) - started
    if (elapsed < 0 || elapsed >= 1000 || signal.aborted)
      throw new GatewayError(504, 'transport_timeout')
    return value
  })
}
