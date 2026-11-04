import { HttpError } from '../sg03/http'
import { paymentConfig, paymentsEnabled } from './config'
import { GatewayError } from '../sg05/bounds'
import { takeApiBudget } from '../sg03/budget'

/** Public entry point is default off, including when only one switch is configured. */
export async function handlePaymentRoute(
  request: Request,
  env: Record<string, unknown>,
) {
  const headers = {
    'Cache-Control': 'private, no-store, max-age=0',
    'X-Content-Type-Options': 'nosniff',
    'Referrer-Policy': 'no-referrer',
  }
  if (!paymentsEnabled(env))
    return Response.json(
      { error: 'payments_disabled' },
      { status: 404, headers },
    )
  try {
    const config = paymentConfig(request, env)
    // A primary session is required; no read-replica stale approval may authorize money.
    const database = config.db.withSession('first-primary')
    await database
      .prepare(
        'SELECT authorization_nonce,submission_started_at,activation_realm,delivery_claims FROM payment_attempts LIMIT 0',
      )
      .all()
    for (const table of [
      'payment_manifests',
      'payment_chain_evidence',
      'payment_submission_reports',
      'payment_quarantine',
    ])
      await database.prepare(`SELECT * FROM ${table} LIMIT 0`).all()
    await takeApiBudget(database, Date.now())
    const [
      { createPaymentGateway },
      { createCdpTransport },
      { createReadRpc },
    ] = await Promise.all([
      import('./gateway'),
      import('./facilitator'),
      import('../sg07/rpc'),
    ])
    const clock = async () => Date.now()
    const raw = createReadRpc(config.rpcUrl, fetch, clock)
    let reads = 0
    const rpc: typeof raw = async (method, params, signal) => {
      if (++reads > 38)
        throw new GatewayError(503, 'payment_rpc_budget_exceeded')
      const value = await raw(method, params, signal)
      if (method === 'eth_getBlockByNumber' && params[0] === 'latest') {
        const b = value as { timestamp?: string }
        if (!b?.timestamp || !/^0x[0-9a-f]+$/i.test(b.timestamp))
          throw new GatewayError(503, 'rpc_head_unavailable')
        const age = BigInt(Date.now()) - BigInt(b.timestamp) * 1000n
        if (age < -1000n || age > 60000n)
          throw new GatewayError(503, 'rpc_head_unavailable')
      }
      return value
    }
    return await createPaymentGateway({
      db: database,
      origin: config.origin,
      realm: 'operator_rpc',
      rpc,
      clock,
      facilitator: createCdpTransport(config),
    })(request)
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof HttpError && error.status === 429
            ? 'payment_request_budget_exceeded'
            : error instanceof GatewayError
              ? error.code
              : 'payment_configuration_or_migrations_unavailable',
      },
      {
        status:
          error instanceof GatewayError || error instanceof HttpError
            ? error.status
            : 503,
        headers,
      },
    )
  }
}
