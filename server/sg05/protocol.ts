import { builderCodeResourceServerExtension } from '@x402/extensions/builder-code'
import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import { GatewayError } from './bounds'
import { NETWORK } from './registry'
export function localProtocol(origin: string) {
  const url = new URL(origin)
  if (
    url.protocol !== 'http:' ||
    url.hostname !== '127.0.0.1' ||
    !url.port ||
    url.origin !== origin
  )
    throw new GatewayError(503, 'loopback_facilitator_required')
  const client = new HTTPFacilitatorClient({ url: origin, timeoutMs: 1000 })
  const server = new x402ResourceServer(client)
    .register(NETWORK, new ExactEvmScheme())
    .registerExtension(builderCodeResourceServerExtension)
  return { client, server }
}
export function cdpCredentialGuard(origin: string) {
  try {
    createCdpFacilitatorClient({
      apiKeyId: '',
      apiKeySecret: '',
      baseUrl: origin,
    })
  } catch (error) {
    return (
      error instanceof Error &&
      error.message.includes('Missing required CDP credentials')
    )
  }
  return false
}
export {
  requirements,
  resourceInfo,
  issuedResourceUrl,
  payment,
  authorizationFresh,
  validVerification,
  validSettlement,
  localSettlementFields,
} from '../payments/protocol'
export type { Authorization } from '../payments/protocol'
