import { generateJwt } from '@coinbase/cdp-sdk/auth'
import type { PaymentPayload, PaymentRequirements } from '@x402/core/types'
import type { FacilitatorClient } from '@x402/core/server'
import { boundedResponse, deadline, GatewayError } from '../sg05/bounds'
import { CDP_ORIGIN, CDP_PATH, type PaymentConfig } from './config'

/** Official CDP HTTP contract and public JWT API. No wallet provisioning/signing. */
export function createCdpTransport(
  config: PaymentConfig,
  dependencies: { transport: typeof fetch; jwt: typeof generateJwt } = {
    transport: fetch,
    jwt: generateJwt,
  },
): FacilitatorClient {
  const call = async (
    operation: 'supported' | 'verify' | 'settle',
    payload?: PaymentPayload,
    requirements?: PaymentRequirements,
  ) =>
    deadline(async (signal) => {
      const method = operation === 'supported' ? 'GET' : 'POST'
      const path = `${CDP_PATH}/${operation}`
      const token = await dependencies.jwt({
        apiKeyId: config.apiKeyId,
        apiKeySecret: config.apiKeySecret,
        requestMethod: method,
        requestHost: 'api.cdp.coinbase.com',
        requestPath: path,
        expiresIn: 60,
      })
      if (signal.aborted) throw new GatewayError(503, 'facilitator_unavailable')
      const response = await dependencies.transport(CDP_ORIGIN + path, {
        method,
        redirect: 'manual',
        cache: 'no-store',
        signal,
        headers: {
          Authorization: `Bearer ${token}`,
          Accept: 'application/json',
          ...(payload ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(payload
          ? {
              body: JSON.stringify({
                x402Version: 2,
                paymentPayload: payload,
                paymentRequirements: requirements,
              }),
            }
          : {}),
      })
      if (response.status !== 200 || response.redirected) {
        void response.body?.cancel().catch(() => {})
        throw new GatewayError(503, 'facilitator_unavailable')
      }
      return boundedResponse(response, 16384, signal)
    }, 8000)
  // Narrow typed projection: callers independently validate every untrusted response.
  return {
    getSupported: async () =>
      (await call('supported')) as Awaited<
        ReturnType<FacilitatorClient['getSupported']>
      >,
    verify: async (p, r) =>
      (await call('verify', p, r)) as Awaited<
        ReturnType<FacilitatorClient['verify']>
      >,
    settle: async (p, r) =>
      (await call('settle', p, r)) as Awaited<
        ReturnType<FacilitatorClient['settle']>
      >,
  }
}
