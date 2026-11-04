import { x402ResourceServer } from '@x402/core/server'
import { ExactEvmScheme } from '@x402/evm/exact/server'
import { encodePaymentRequiredHeader } from '@x402/core/http'
import {
  builderCodeResourceServerExtension,
  BuilderCodeFacilitatorExtension,
  encodeBuilderCodeSuffix,
  parseBuilderCodeSuffixFromCalldata,
} from '@x402/extensions/builder-code'
import {
  signalArcBuilderDeclaration,
  SIGNALARC_BUILDER_CODE,
  validSignalArcBuilderEcho,
} from '../../server/sg07/builder-code'

let blockedEgress = 0
globalThis.fetch = async () => {
  blockedEgress++
  throw Error('Builder probe forbids all outbound traffic')
}

export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: {
    SIGNALARC_DB: D1Database
    APP_ENV: string
    APP_ORIGIN: string
    BUILDER_LOCAL_ONLY?: string
  }
}) {
  const url = new URL(request.url)
  if (
    env.APP_ENV !== 'local' ||
    env.BUILDER_LOCAL_ONLY !== 'yes' ||
    url.hostname !== '127.0.0.1' ||
    url.origin !== env.APP_ORIGIN ||
    (await env.SIGNALARC_DB.prepare('SELECT 1').all()).meta.served_by !==
      'miniflare.db'
  )
    return new Response('Local only', { status: 404 })
  if (request.method !== 'GET' || url.search)
    return new Response('Format probe only', { status: 400 })
  let verifyCalls = 0,
    settleCalls = 0
  const server = new x402ResourceServer({
    getSupported: async () => ({
      kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }],
      extensions: ['builder-code'],
      signers: {},
    }),
    verify: async () => {
      verifyCalls++
      throw Error('Never verify')
    },
    settle: async () => {
      settleCalls++
      throw Error('Never settle')
    },
  })
    .register('eip155:8453', new ExactEvmScheme())
    .registerExtension(builderCodeResourceServerExtension)
  await server.initialize()
  const required = (
    await server.buildPaymentRequirements({
      scheme: 'exact',
      network: 'eip155:8453',
      payTo: '0x000000000000000000000000000000000000b0b1',
      price: {
        asset: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
        amount: '1',
        extra: { name: 'USD Coin', version: '2' },
      },
      maxTimeoutSeconds: 60,
      extra: { assetTransferMethod: 'eip3009', paymentFlow: 'upfront' },
    })
  )[0]
  const declaration = signalArcBuilderDeclaration(8453)
  const challenge = await server.createPaymentRequiredResponse(
    [required],
    {
      url: url.origin + '/builder-code/preview',
      mimeType: 'application/json',
      description: 'LOCAL FORMAT TEST ONLY — do not pay',
    },
    undefined,
    declaration,
  )
  const headers = {
    'Cache-Control': 'private, no-store',
    'X-SignalArc-Mode': 'LOCAL FORMAT TEST ONLY',
  }
  if (url.pathname === '/builder-code/preview')
    return Response.json(challenge, {
      status: 402,
      headers: {
        ...headers,
        'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge),
      },
    })
  const suffix = encodeBuilderCodeSuffix({ a: SIGNALARC_BUILDER_CODE })
  // Format-only payload: deliberately NOT a valid signed payment. No signing/verification.
  const payload = {
    x402Version: 2 as const,
    accepted: required,
    payload: Object.freeze({
      authorization: Object.freeze({ nonce: 'LOCAL_FORMAT_SENTINEL' }),
      signature: 'UNSIGNED_FORMAT_SENTINEL',
    }),
    extensions: declaration,
  }
  const before = JSON.stringify(payload)
  Object.freeze(payload)
  const facilitator = new BuilderCodeFacilitatorExtension()
  const built = facilitator.buildDataSuffix({
    paymentPayload: payload,
    paymentRequirements: required,
  })
  let wrongChainRejected = false
  try {
    signalArcBuilderDeclaration(1)
  } catch {
    wrongChainRejected = true
  }
  return Response.json(
    {
      echoPolicy: {
        exact: validSignalArcBuilderEcho(declaration),
        service: validSignalArcBuilderEcho({
          'builder-code': {
            info: { a: SIGNALARC_BUILDER_CODE, s: ['cdp_sdk_client'] },
          },
        }),
        forgedWallet: validSignalArcBuilderEcho({
          'builder-code': { info: { a: SIGNALARC_BUILDER_CODE, w: 'forged' } },
        }),
        wrongApp: validSignalArcBuilderEcho({
          'builder-code': { info: { a: 'other' } },
        }),
        oversizedServices: validSignalArcBuilderEcho({
          'builder-code': {
            info: { a: SIGNALARC_BUILDER_CODE, s: Array(6).fill('x') },
          },
        }),
      },
      code: SIGNALARC_BUILDER_CODE,
      declaration,
      suffix,
      decoded: parseBuilderCodeSuffixFromCalldata(suffix),
      mockSenderSuffix: built,
      payloadUnchanged: before === JSON.stringify(payload),
      wrongChainRejected,
      verifyCalls,
      settleCalls,
      blockedEgress,
      productionEnabled: false,
      onchainAttributionVerified: false,
    },
    { headers },
  )
}
