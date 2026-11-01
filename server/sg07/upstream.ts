import { GatewayError } from '../sg05/bounds'
import { httpsUpstream } from '../../shared/resources'
import type { Snapshot } from '../sg05/registry'
import type { JsonTransport, UpstreamAccess } from '../sg05/upstream'
/** URL allowlisting alone cannot establish the actual Cloudflare outbound peer address. */
export function productionUpstream(url: string): never {
  httpsUpstream(url)
  throw new GatewayError(503, 'connection_safe_transport_unavailable')
}

export interface LocalUpstreamEntry {
  resourceId: string
  merchantId: string
  url: string
}
/** Policy demonstrator only. A matching URL is NOT proof of a safe network peer. No default fetch. */
export function createLocalUpstreamAccess(
  resolve: (
    resourceId: string,
    merchantId: string,
  ) => Promise<LocalUpstreamEntry | null>,
  request: JsonTransport,
): UpstreamAccess {
  return {
    async assertEligible(snapshot: Snapshot) {
      const url = httpsUpstream(snapshot.resource.upstreamUrl)
      const entry = await resolve(snapshot.id, snapshot.merchantId)
      if (
        !entry ||
        entry.resourceId !== snapshot.id ||
        entry.merchantId !== snapshot.merchantId ||
        httpsUpstream(entry.url) !== url ||
        new URL(url).search
      )
        throw new GatewayError(503, 'upstream_not_eligible')
    },
    request,
  }
}
