import { HTTPFacilitatorClient, x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { PaymentPayloadSchema } from '@x402/core/schemas'
import { decodePaymentSignatureHeader } from '@x402/core/http'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
} from '@x402/core/types'
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import { walletAddress } from '../../shared/resources'
import { hash } from '../sg03/http'
import { boundedJson, canonical, GatewayError } from './bounds'
import { NETWORK, USDC, type Snapshot } from './registry'
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
  const server = new x402ResourceServer(client).register(
    NETWORK,
    new ExactEvmScheme(),
  )
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
export async function requirements(server: x402ResourceServer, s: Snapshot) {
  await server.initialize()
  return (
    await server.buildPaymentRequirements({
      scheme: 'exact',
      network: NETWORK,
      payTo: s.resource.payoutAddress,
      price: {
        asset: USDC,
        amount: s.resource.priceAtomic,
        extra: { name: 'USD Coin', version: '2' },
      },
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009', paymentFlow: 'upfront' },
    })
  )[0]
}
export function resourceInfo(url: string) {
  return {
    url,
    description: 'LOCAL SIMULATION ONLY — do not pay',
    mimeType: 'application/json',
  }
}
export interface Authorization {
  from: string
  to: string
  value: string
  validAfter: string
  validBefore: string
  nonce: string
}
/** Metadata is untrusted until the gateway resolves its issued ticket and matches the D1 snapshot. */
export function issuedResourceUrl(header: string): string {
  if (header.length > 8192) throw new GatewayError(413, 'payment_header_limit')
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      header,
    )
  )
    throw new GatewayError(400, 'invalid_payment_header')
  boundedJson(atob(header))
  const decoded = decodePaymentSignatureHeader(header)
  if (
    typeof decoded?.resource?.url !== 'string' ||
    decoded.resource.url.length > 2048
  )
    throw new GatewayError(400, 'server_challenge_required')
  return decoded.resource.url
}
export async function payment(
  header: string,
  required: PaymentRequirements,
  url: string,
) {
  if (header.length > 8192) throw new GatewayError(413, 'payment_header_limit')
  if (
    !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(
      header,
    )
  )
    throw new GatewayError(400, 'invalid_payment_header')
  boundedJson(atob(header))
  const raw = decodePaymentSignatureHeader(header)
  if (
    raw.x402Version !== 2 ||
    canonical(raw.accepted) !== canonical(required) ||
    canonical(raw.resource) !== canonical(resourceInfo(url)) ||
    raw.extensions
  )
    throw new GatewayError(402, 'payment_requirements_mismatch')
  const payload = raw.payload
  if (
    !payload ||
    Object.keys(payload).sort().join(',') !== 'authorization,signature' ||
    typeof payload.signature !== 'string' ||
    !/^0x[0-9a-fA-F]{130}$/.test(payload.signature)
  )
    throw new GatewayError(400, 'invalid_payment_payload')
  const a = payload.authorization as Authorization
  if (
    !a ||
    ['from', 'to', 'value', 'validAfter', 'validBefore', 'nonce'].some(
      (k) => typeof (a as unknown as Record<string, unknown>)[k] !== 'string',
    ) ||
    Object.keys(a).sort().join(',') !==
      'from,nonce,to,validAfter,validBefore,value' ||
    !/^0x[0-9a-fA-F]{64}$/.test(a.nonce) ||
    !/^(?:0|[1-9]\d{0,10})$/.test(a.validAfter) ||
    !/^[1-9]\d{0,10}$/.test(a.validBefore) ||
    a.value !== required.amount ||
    walletAddress(a.to).toLowerCase() !== required.payTo.toLowerCase()
  )
    throw new GatewayError(402, 'authorization_mismatch')
  const payer = walletAddress(a.from).toLowerCase()
  const parsed = PaymentPayloadSchema.safeParse(raw)
  if (!parsed.success) throw new GatewayError(400, 'invalid_payment_schema')
  const identity = await hash(
    canonical([NETWORK, USDC.toLowerCase(), payer, a.nonce.toLowerCase()]),
  )
  const fingerprint = await hash(
    canonical({
      authorization: {
        ...a,
        from: payer,
        to: a.to.toLowerCase(),
        nonce: a.nonce.toLowerCase(),
      },
      signature: payload.signature.toLowerCase(),
    }),
  )
  return { payload: raw as PaymentPayload, a, payer, identity, fingerprint }
}
export function authorizationFresh(a: Authorization, nowMs: number) {
  const now = Math.floor(nowMs / 1000)
  return (
    BigInt(a.validAfter) < BigInt(now) &&
    BigInt(a.validBefore) > BigInt(now + 5) &&
    BigInt(a.validBefore) <= BigInt(now + 300)
  )
}
/** Runtime checks apply even to injected clients whose TypeScript types promise valid replies. */
export function validVerification(result: unknown, payer: string): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return false
  const r = result as Record<string, unknown>
  return (
    r.isValid === true &&
    typeof r.payer === 'string' &&
    r.payer.toLowerCase() === payer.toLowerCase() &&
    (r.invalidReason === undefined || r.invalidReason === '') &&
    (r.invalidMessage === undefined || r.invalidMessage === '')
  )
}
export function validSettlement(
  result: unknown,
  payer: string,
  amount: string,
  recipient: string,
): boolean {
  if (!result || typeof result !== 'object' || Array.isArray(result))
    return false
  const r = result as Record<string, unknown>
  if (
    r.extra !== undefined &&
    (!r.extra || typeof r.extra !== 'object' || Array.isArray(r.extra))
  )
    return false
  const extra = r.extra as Record<string, unknown> | undefined
  return (
    r.success === true &&
    r.network === NETWORK &&
    typeof r.transaction === 'string' &&
    /^0x[0-9a-fA-F]{64}$/.test(r.transaction) &&
    !/^0x0{64}$/.test(r.transaction) &&
    typeof r.payer === 'string' &&
    r.payer.toLowerCase() === payer.toLowerCase() &&
    (r.amount === undefined || r.amount === amount) &&
    (r.errorReason === undefined || r.errorReason === '') &&
    (r.errorMessage === undefined || r.errorMessage === '') &&
    (extra?.asset === undefined ||
      (typeof extra.asset === 'string' &&
        extra.asset.toLowerCase() === USDC.toLowerCase())) &&
    (extra?.recipient === undefined ||
      (typeof extra.recipient === 'string' &&
        extra.recipient.toLowerCase() === recipient.toLowerCase()))
  )
}

/** Local receipt/header projection. No provider diagnostics, bearer data or production authority. */
export function localSettlementFields(result: SettleResponse) {
  return {
    success: result.success,
    transaction: result.transaction,
    network: result.network,
    payer: result.payer,
    ...(result.amount === undefined ? {} : { amount: result.amount }),
    extra: {
      ...(result.extra?.asset === undefined
        ? {}
        : { asset: result.extra.asset }),
      ...(result.extra?.recipient === undefined
        ? {}
        : { recipient: result.extra.recipient }),
      localSimulationOnly: true,
    },
  }
}
