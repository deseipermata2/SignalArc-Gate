import { httpsUpstream } from '../../shared/resources'
import { boundedResponse, deadline, GatewayError } from './bounds'
import type { Snapshot } from './registry'
import { clockTime, type TrustedClock } from './clock'
/** No default fetch: a separately reviewed connection-safe transport is mandatory. */
export type JsonTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>
export async function protectedJson(
  s: Snapshot,
  transport: JsonTransport,
  clock: TrustedClock,
) {
  const url = httpsUpstream(s.resource.upstreamUrl)
  const started = await clockTime(clock)
  const value = await deadline(async (signal) => {
    const response = await transport(url, {
      method: 'GET',
      redirect: 'manual',
      headers: { Accept: 'application/json' },
      signal,
    })
    if (!response.ok || response.status >= 300) {
      await response.body?.cancel()
      throw new GatewayError(502, 'upstream_unavailable_or_redirect')
    }
    return boundedResponse(response, s.resource.responseConfig.maxBytes, signal)
  })
  // Timer scheduling alone is not proof of elapsed time in workerd. Never release a late body.
  if ((await clockTime(clock)) - started >= 1000)
    throw new GatewayError(504, 'transport_timeout')
  return value
}
