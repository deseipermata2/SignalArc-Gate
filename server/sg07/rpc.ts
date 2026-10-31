import { httpsUpstream } from '../../shared/resources'
import { boundedResponse, deadline, GatewayError } from '../sg05/bounds'
import { clockTime, type TrustedClock } from '../sg05/clock'
import type { RegistryRpc } from './registry'
/** Server-owned fixed endpoint and transport; never accepts buyer/merchant URL input. No default fetch. */
export function createReadRpc(
  endpoint: string,
  transport: typeof fetch,
  clock: TrustedClock,
): RegistryRpc {
  const url = httpsUpstream(endpoint)
  if (new URL(url).search) throw new GatewayError(503, 'rpc_endpoint_policy')
  let sequence = 0
  return async (method, params, outer) => {
    if (
      ![
        'eth_chainId',
        'eth_getBlockByNumber',
        'eth_getCode',
        'eth_call',
      ].includes(method)
    )
      throw new GatewayError(503, 'rpc_method_forbidden')
    const started = await clockTime(clock),
      id = ++sequence
    return deadline(async (signal) => {
      const combined = AbortSignal.any([signal, outer])
      const response = await transport(url, {
        method: 'POST',
        redirect: 'manual',
        cache: 'no-store',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        signal: combined,
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      })
      if (response.status !== 200) {
        await response.body?.cancel()
        throw new GatewayError(503, 'rpc_http_failure')
      }
      const body = (await boundedResponse(
        response,
        131072,
        combined,
        65536,
      )) as Record<string, unknown>
      if ((await clockTime(clock)) - started >= 2000 || combined.aborted)
        throw new GatewayError(504, 'rpc_timeout')
      if (
        !body ||
        body.jsonrpc !== '2.0' ||
        body.id !== id ||
        !Object.hasOwn(body, 'result') ||
        Object.hasOwn(body, 'error')
      )
        throw new GatewayError(503, 'rpc_response_invalid')
      return body.result
    }, 2000)
  }
}
