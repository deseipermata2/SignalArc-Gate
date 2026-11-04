import { deployment } from '../registry/status'
import { GatewayError } from '../sg05/bounds'

export const POLICY_ID = 'base-finalized-internal-json-v1'
export const CDP_ORIGIN = 'https://api.cdp.coinbase.com'
export const CDP_PATH = '/platform/v2/x402'
export type PaymentDatabase = Pick<D1Database, 'prepare' | 'batch'>
export interface PaymentConfig {
  db: D1Database
  origin: string
  rpcUrl: string
  apiKeyId: string
  apiKeySecret: string
  policyId: typeof POLICY_ID
  registryAddress: string
  runtimeCodeHash: string
}
export function paymentsEnabled(env: Record<string, unknown>): boolean {
  return (
    env.X402_PAYMENTS_ENABLED === 'true' &&
    env.X402_EMERGENCY_DISABLED === 'false'
  )
}
export function paymentConfig(
  request: Request,
  env: Record<string, unknown>,
): PaymentConfig {
  const fail = (): never => {
    throw new GatewayError(503, 'payment_configuration_unavailable')
  }
  if (!paymentsEnabled(env)) throw new GatewayError(404, 'payments_disabled')
  if (
    env.BASE_CHAIN_ID !== '8453' ||
    env.X402_POLICY_ID !== POLICY_ID ||
    env.APP_ORIGIN !== 'https://gate.signalarc.fun' ||
    new URL(request.url).origin !== env.APP_ORIGIN
  )
    fail()
  const db = env.SIGNALARC_DB as D1Database | undefined
  if (!db || typeof db.prepare !== 'function' || typeof db.batch !== 'function')
    fail()
  const text = (name: string, max: number) => {
    const v = env[name]
    if (typeof v !== 'string' || !v.trim() || v.length > max) return fail()
    return v
  }
  const rpcUrl = text('REGISTRY_RPC_URL', 2048)
  let rpc: URL
  try {
    rpc = new URL(rpcUrl)
  } catch {
    return fail()
  }
  // Existing owner-selected provider; no caller URLs or generic merchant egress.
  if (
    rpc.protocol !== 'https:' ||
    rpc.hostname !== 'base-mainnet.g.alchemy.com' ||
    rpc.port ||
    rpc.username ||
    rpc.password ||
    rpc.search ||
    rpc.hash ||
    !/^\/v2\/[A-Za-z0-9_-]+$/.test(rpc.pathname)
  )
    fail()
  return {
    db: db!,
    origin: String(env.APP_ORIGIN),
    rpcUrl,
    apiKeyId: text('CDP_API_KEY_ID', 256),
    apiKeySecret: text('CDP_API_KEY_SECRET', 8192),
    policyId: POLICY_ID,
    registryAddress: deployment.address,
    runtimeCodeHash: deployment.runtimeCodeHash,
  }
}
