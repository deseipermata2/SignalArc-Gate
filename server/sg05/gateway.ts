import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import type { PaymentRequirements, SettleResponse } from '@x402/core/types'
import { clockTime, type TrustedClock } from './clock'
import { hash, randomToken } from '../sg03/http'
import { deadline, GatewayError, reply } from './bounds'
import { snapshot, type RegistryReader, type Snapshot } from './registry'
import {
  authorizationFresh,
  issuedResourceUrl,
  localProtocol,
  payment,
  requirements,
  resourceInfo,
  validSettlement,
} from './protocol'
import { PaymentStore, type Attempt } from './store'
import { protectedJson, type JsonTransport } from './upstream'
export interface LocalServices {
  db: D1Database
  origin: string
  facilitatorOrigin: string
  registry: RegistryReader
  upstream: JsonTransport
  clock: TrustedClock
}
/** Deliberately not imported by production Functions. Success is only a labeled local simulation. */
export function createLocalGateway(services: LocalServices) {
  const { db, origin, facilitatorOrigin, registry, upstream, clock } = services
  const store = new PaymentStore(db, clock)
  async function unchanged(a: Attempt) {
    const current = await deadline(() =>
      snapshot(db, a.resource_id, registry, clock),
    )
    if (current.hash !== a.snapshot_hash)
      throw new GatewayError(409, 'resource_configuration_changed')
    return current
  }
  async function fulfill(a: Attempt, s: Snapshot) {
    if (!(await store.advance(a.id, 'settled', 'fulfilling', null, s)))
      throw new GatewayError(409, 'fulfillment_already_claimed_or_changed')
    try {
      const receipt = await store.receipt(a.id)
      if (!receipt) throw new GatewayError(503, 'settlement_record_unavailable')
      const value = await protectedJson(s, upstream)
      const final = await unchanged(a)
      if (!(await store.advance(a.id, 'fulfilling', 'fulfilled', null, final)))
        throw new GatewayError(409, 'resource_configuration_changed')
      return reply(
        200,
        { localSimulationOnly: true, data: value },
        {
          'PAYMENT-RESPONSE': encodePaymentResponseHeader(
            JSON.parse(receipt.settlement_json),
          ),
        },
      )
    } catch (error) {
      await store
        .advance(
          a.id,
          'fulfilling',
          'fulfillment_failed',
          'fulfillment_unavailable',
        )
        .catch(() => {})
      throw error
    }
  }
  return async (request: Request): Promise<Response> => {
    let active: Attempt | null = null
    let owned = false
    try {
      const url = new URL(request.url)
      if (url.origin !== origin || url.hostname !== '127.0.0.1')
        throw new GatewayError(404, 'local_gateway_disabled')
      const database = await db.prepare('SELECT 1').all()
      if (database.meta.served_by !== 'miniflare.db')
        throw new GatewayError(404, 'local_database_required')
      if (request.method !== 'GET') throw new GatewayError(405, 'get_only')
      if (request.url.length > 2048)
        throw new GatewayError(414, 'request_url_limit')
      let headerBytes = 0
      request.headers.forEach((v, k) => {
        headerBytes += k.length + v.length
      })
      if (
        headerBytes > 16384 ||
        Number(request.headers.get('Content-Length') ?? 0) > 0 ||
        request.body
      )
        throw new GatewayError(413, 'request_size_limit')
      const header = request.headers.get('PAYMENT-SIGNATURE')
      if (header && header.length > 8192)
        throw new GatewayError(413, 'payment_header_limit')
      const resource = url.pathname.match(/^\/sg05\/pay\/([a-f0-9-]{36})$/)?.[1]
      if (!resource) throw new GatewayError(404, 'resource_not_found')
      if (
        [...url.searchParams.keys()].some(
          (k) => !['attempt', 'ticket'].includes(k),
        ) ||
        url.searchParams.getAll('attempt').length > 1 ||
        url.searchParams.getAll('ticket').length > 1
      )
        throw new GatewayError(400, 'invalid_request_identity')
      // Ordinary x402 clients retry the original URL. Its bounded envelope carries the issued URL.
      // It may supply only a ticket for this exact origin/path; D1 and full requirements validate it below.
      if (!url.search && header) {
        let issued: URL
        try {
          issued = new URL(issuedResourceUrl(header))
        } catch (error) {
          throw error instanceof GatewayError
            ? error
            : new GatewayError(400, 'invalid_payment_header')
        }
        if (
          issued.origin !== url.origin ||
          issued.pathname !== url.pathname ||
          !issued.search
        )
          throw new GatewayError(400, 'server_challenge_required')
        url.search = issued.search
        if (
          [...url.searchParams.keys()].some(
            (k) => !['attempt', 'ticket'].includes(k),
          ) ||
          url.searchParams.getAll('attempt').length !== 1 ||
          url.searchParams.getAll('ticket').length !== 1
        )
          throw new GatewayError(400, 'invalid_request_identity')
      }
      const attemptId = url.searchParams.get('attempt'),
        ticket = url.searchParams.get('ticket')
      if (!attemptId) {
        if (header || ticket)
          throw new GatewayError(400, 'server_challenge_required')
        const s = await deadline(() => snapshot(db, resource, registry, clock))
        const { server } = localProtocol(facilitatorOrigin)
        const required = await deadline(() => requirements(server, s))
        const id = crypto.randomUUID(),
          token = randomToken()
        url.searchParams.set('attempt', id)
        url.searchParams.set('ticket', token)
        await store.create(
          id,
          s,
          await hash(token),
          await hash(url.href),
          required,
        )
        const challenge = await server.createPaymentRequiredResponse(
          [required],
          resourceInfo(url.href),
        )
        return reply(402, challenge, {
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge),
        })
      }
      if (
        !/^[a-f0-9-]{36}$/.test(attemptId) ||
        !ticket ||
        !/^[a-f0-9]{64}$/.test(ticket)
      )
        throw new GatewayError(400, 'invalid_request_identity')
      active = await store.get(attemptId)
      if (
        !active ||
        active.resource_id !== resource ||
        active.request_hash !== (await hash(ticket)) ||
        active.url_hash !== (await hash(url.href))
      )
        throw new GatewayError(404, 'request_not_found')
      if (!header) {
        if (
          active.phase !== 'created' ||
          active.expires_at <= (await clockTime(clock))
        )
          throw new GatewayError(409, 'attempt_not_payable')
        const s = await unchanged(active)
        void s
        const required = JSON.parse(
          active.requirements_json,
        ) as PaymentRequirements
        const challenge = {
          x402Version: 2,
          resource: resourceInfo(url.href),
          accepts: [required],
        }
        return reply(402, challenge, {
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge),
        })
      }
      let signed: Awaited<ReturnType<typeof payment>>
      try {
        signed = await payment(
          header,
          JSON.parse(active.requirements_json),
          url.href,
        )
      } catch (error) {
        if (active.phase === 'created')
          await store.advance(
            active.id,
            'created',
            'rejected',
            'authorization_invalid',
          )
        throw error instanceof GatewayError
          ? error
          : new GatewayError(400, 'invalid_payment_payload')
      }
      if (active.phase === 'settled') {
        if (
          active.authorization_key !== signed.identity ||
          active.authorization_fingerprint !== signed.fingerprint
        )
          throw new GatewayError(409, 'authorization_replay')
        owned = true
        return await fulfill(active, await unchanged(active))
      }
      if (active.phase !== 'created')
        throw new GatewayError(
          409,
          active.phase === 'settlement_pending' ||
            active.phase === 'settlement_unknown'
            ? 'settlement_requires_reconciliation'
            : 'authorization_already_used',
        )
      if (
        active.expires_at <= (await clockTime(clock)) ||
        !authorizationFresh(signed.a, await clockTime(clock))
      ) {
        await store.advance(
          active.id,
          'created',
          'rejected',
          'authorization_expired',
        )
        throw new GatewayError(402, 'authorization_expired')
      }
      const initial = await unchanged(active)
      if (
        !(await store.claim(
          active,
          signed.identity,
          signed.fingerprint,
          signed.payer,
        ))
      )
        throw new GatewayError(409, 'attempt_already_claimed')
      owned = true
      active = {
        ...active,
        authorization_key: signed.identity,
        authorization_fingerprint: signed.fingerprint,
        buyer_address: signed.payer,
      }
      const { client } = localProtocol(facilitatorOrigin)
      let verified
      try {
        verified = await deadline(() =>
          client.verify(signed.payload, JSON.parse(active!.requirements_json)),
        )
      } catch {
        await store.advance(
          active.id,
          'verifying',
          'failed',
          'verification_unavailable',
        )
        throw new GatewayError(502, 'verification_unavailable')
      }
      if (
        verified.isValid !== true ||
        verified.payer?.toLowerCase() !== signed.payer
      ) {
        await store.advance(
          active.id,
          'verifying',
          'rejected',
          'verification_rejected',
        )
        throw new GatewayError(402, 'verification_rejected')
      }
      const afterVerify = await unchanged(active)
      if (
        initial.hash !== afterVerify.hash ||
        !(await store.advance(
          active.id,
          'verifying',
          'verified',
          null,
          afterVerify,
        ))
      )
        throw new GatewayError(409, 'resource_configuration_changed')
      const beforeSettle = await unchanged(active)
      if (
        !authorizationFresh(signed.a, await clockTime(clock)) ||
        !(await store.advance(
          active.id,
          'verified',
          'settlement_pending',
          null,
          beforeSettle,
        ))
      )
        throw new GatewayError(409, 'resource_configuration_changed')
      let result: SettleResponse
      try {
        result = await deadline(() =>
          client.settle(signed.payload, JSON.parse(active!.requirements_json)),
        )
      } catch {
        await store.advance(
          active.id,
          'settlement_pending',
          'settlement_unknown',
          'settlement_transport_unknown',
        )
        throw new GatewayError(503, 'settlement_requires_reconciliation')
      }
      if (
        !validSettlement(
          result,
          signed.payer,
          active.amount_atomic,
          active.recipient,
        )
      ) {
        const definite =
          result.success === false &&
          result.transaction === '' &&
          result.errorReason ===
            'local_simulation_rejected_before_submission' &&
          result.extra?.submitted === false &&
          result.extra.localSimulationOnly === true &&
          result.network === 'eip155:8453' &&
          result.payer?.toLowerCase() === signed.payer &&
          (result.amount === undefined ||
            result.amount === active.amount_atomic)
        await store.advance(
          active.id,
          'settlement_pending',
          definite ? 'failed' : 'settlement_unknown',
          definite ? 'settlement_rejected' : 'settlement_response_unknown',
        )
        throw new GatewayError(
          503,
          definite
            ? 'settlement_rejected'
            : 'settlement_requires_reconciliation',
        )
      }
      try {
        if (!(await store.settle(active, result, 'settlement_pending')))
          throw new Error('settlement CAS lost')
      } catch {
        await store
          .advance(
            active.id,
            'settlement_pending',
            'settlement_unknown',
            'receipt_persistence_unknown',
          )
          .catch(() => {})
        throw new GatewayError(503, 'settlement_requires_reconciliation')
      }
      const current = await unchanged(active)
      return await fulfill(active, current)
    } catch (error) {
      if (active && owned) {
        await store
          .advance(active.id, 'verifying', 'failed', 'pre_settlement_aborted')
          .catch(() => {})
        await store
          .advance(active.id, 'verified', 'failed', 'pre_settlement_aborted')
          .catch(() => {})
        await store
          .advance(
            active.id,
            'settled',
            'fulfillment_failed',
            'configuration_or_fulfillment_unavailable',
          )
          .catch(() => {})
      }
      return reply(error instanceof GatewayError ? error.status : 503, {
        localSimulationOnly: true,
        error:
          error instanceof GatewayError ? error.code : 'gateway_unavailable',
      })
    }
  }
}
