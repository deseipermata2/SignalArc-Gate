import type { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import type {
  PaymentPayload,
  PaymentRequirements,
  SettleResponse,
  VerifyResponse,
} from '@x402/core/types'
import { boundedJson, canonical, deadline, GatewayError } from '../sg05/bounds'
import { clockTime, type TrustedClock } from '../sg05/clock'
import {
  authorizationFresh,
  payment,
  validSettlement,
  type Authorization,
} from '../sg05/protocol'
import { NETWORK, USDC } from '../sg05/registry'
import { walletAddress } from '../../shared/resources'

type OfficialClient = ReturnType<typeof createCdpFacilitatorClient>
export type FacilitatorClient = Pick<OfficialClient, 'verify' | 'settle'>
export type SettlementOutcome =
  | { disposition: 'reported_settled'; result: SettleResponse }
  | { disposition: 'settlement_unknown' }
interface Verified {
  payload: PaymentPayload
  required: PaymentRequirements
  payer: string
}
/** Integration boundary only: no client factory, credentials, routes, persistence or fulfillment. */
export function createFacilitatorAdapter(
  client: FacilitatorClient,
  clock: TrustedClock,
) {
  const verified = new WeakSet<Verified>()
  return {
    async verify(
      header: string,
      required: PaymentRequirements,
      issuedUrl: string,
    ): Promise<Verified> {
      // Only server-owned requirements may reach this adapter. Reuse the bounded exact-header parser.
      if (
        required.scheme !== 'exact' ||
        required.network !== NETWORK ||
        required.asset.toLowerCase() !== USDC.toLowerCase() ||
        !/^[1-9]\d{0,11}$/.test(required.amount) ||
        required.extra?.paymentFlow !== 'upfront' ||
        required.extra?.assetTransferMethod !== 'eip3009'
      )
        throw new GatewayError(503, 'facilitator_requirements_invalid')
      walletAddress(required.payTo)
      const fixed = JSON.parse(canonical(required)) as PaymentRequirements
      const parsed = await payment(header, fixed, issuedUrl)
      const started = await clockTime(clock)
      if (!authorizationFresh(parsed.a, started))
        throw new GatewayError(402, 'authorization_expired')
      let response: VerifyResponse
      try {
        response = await deadline(() => client.verify(parsed.payload, fixed))
      } catch {
        throw new GatewayError(503, 'facilitator_verification_unavailable')
      }
      boundedJson(JSON.stringify(response))
      if (
        (await clockTime(clock)) - started >= 1000 ||
        response.isValid !== true ||
        response.payer?.toLowerCase() !== parsed.payer ||
        response.invalidReason
      )
        throw new GatewayError(402, 'facilitator_verification_rejected')
      const token = {
        payload: parsed.payload,
        required: fixed,
        payer: parsed.payer,
      }
      // Copies are private to the closure; callers receive only opaque identity.
      const permit = Object.freeze({}) as Verified
      verified.add(permit)
      verifiedData.set(permit, token)
      return permit
    },
    async settleAfterClaim(
      permit: Verified,
      claimPending: () => Promise<boolean>,
    ): Promise<SettlementOutcome> {
      const data = verifiedData.get(permit)
      if (!verified.has(permit) || !data)
        throw new GatewayError(409, 'verified_payment_required')
      // Consume in-process permission even on claim failure. D1 CAS must additionally guard restart/replay.
      verified.delete(permit)
      verifiedData.delete(permit)
      if (
        !authorizationFresh(
          data.payload.payload.authorization as Authorization,
          await clockTime(clock),
        )
      )
        throw new GatewayError(402, 'authorization_expired')
      if (!(await claimPending()))
        throw new GatewayError(409, 'settlement_already_claimed')
      const started = await clockTime(clock)
      try {
        const response = await deadline(() =>
          client.settle(data.payload, data.required),
        )
        boundedJson(JSON.stringify(response))
        if (
          (await clockTime(clock)) - started >= 1000 ||
          !validSettlement(
            response,
            data.payer,
            data.required.amount,
            data.required.payTo,
          )
        )
          return { disposition: 'settlement_unknown' }
        // This is a facilitator report, NOT independently confirmed onchain evidence or permission to fulfill.
        return { disposition: 'reported_settled', result: response }
      } catch {
        return { disposition: 'settlement_unknown' }
      }
    },
  }
}
const verifiedData = new WeakMap<Verified, Verified>()
