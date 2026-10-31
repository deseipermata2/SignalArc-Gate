import { GatewayError } from '../sg05/bounds'
import { httpsUpstream } from '../../shared/resources'
/** URL allowlisting alone cannot establish the actual Cloudflare outbound peer address. */
export function productionUpstream(url: string): never {
  httpsUpstream(url)
  throw new GatewayError(503, 'connection_safe_transport_unavailable')
}
