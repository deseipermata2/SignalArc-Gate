import { httpsUpstream } from '../../shared/resources'
import { boundedResponse, deadline, GatewayError } from './bounds'
import type { Snapshot } from './registry'
/** No default fetch: a separately reviewed connection-safe transport is mandatory. */
export type JsonTransport = (
  url: string,
  init: RequestInit,
) => Promise<Response>
export async function protectedJson(s: Snapshot, transport: JsonTransport) {
  const url = httpsUpstream(s.resource.upstreamUrl)
  return deadline(async (signal) => {
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
}
