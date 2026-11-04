import { internalDocument } from './document'
import type { PaymentDatabase } from './config'
import {
  encodePaymentRequiredHeader,
  encodePaymentResponseHeader,
} from '@x402/core/http'
import { verifyTypedData, type Hex } from 'viem'
import type { FacilitatorClient } from '@x402/core/server'
import type { PaymentRequirements, SettleResponse } from '@x402/core/types'
import { randomToken, hash } from '../sg03/http'
import { deadline, GatewayError } from '../sg05/bounds'
import { monotonicClock } from '../sg05/clock'
import { NETWORK, USDC } from '../sg05/registry'
import { createSettlementObserver } from '../sg07/settlement-evidence'
import {
  signalArcBuilderDeclaration,
  validSignalArcBuilderEcho,
} from '../sg07/builder-code'
import type { RegistryRpc } from '../sg07/registry'
import {
  authorizationFresh,
  issuedResourceUrl,
  payment,
  validVerification,
  validSettlement,
} from './protocol'
import { ActivationStore, type ActivationAttempt } from './store'
import {
  currentResource,
  eligibleResource,
  persistEvidence,
  checkQuarantine,
  quarantine,
  type ActiveResource,
  type Clock,
  type Realm,
  unavailable,
} from './authority'

export interface GatewayServices {
  db: PaymentDatabase
  realm: Realm
  origin: string
  rpc: RegistryRpc
  clock: Clock
  facilitator: FacilitatorClient
}
function response(
  status: number,
  body: unknown,
  headers: Record<string, string> = {},
) {
  return Response.json(body, {
    status,
    headers: {
      'Cache-Control': 'private, no-store, max-age=0',
      Pragma: 'no-cache',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'no-referrer',
      ...headers,
    },
  })
}
const info = (url: string) => ({
  url,
  description: 'SignalArc Gate internal JSON resource',
  mimeType: 'application/json',
})
const txHash = (v: unknown): v is string =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0{64}$/.test(v)
/** No signer or transport can be selected by public request data. Tests inject only local realm services. */
export function createPaymentGateway(services: GatewayServices) {
  const { db, realm, origin, rpc, facilitator } = services,
    clock = monotonicClock(services.clock),
    store = new ActivationStore(db, realm, clock)
  const eligible = (id: string) =>
    deadline(() => eligibleResource(db, id, realm, rpc, clock), 10000)
  async function sameSnapshot(a: ActivationAttempt) {
    const s = await currentResource(db, a.resource_id, realm, clock)
    if (s.hash !== a.snapshot_hash) unavailable('resource_admission_changed')
    return s
  }
  async function unchanged(a: ActivationAttempt) {
    const s = await eligible(a.resource_id)
    if (s.hash !== a.snapshot_hash) unavailable('resource_admission_changed')
    return s
  }
  async function finalized(a: ActivationAttempt, transaction: string) {
    await checkQuarantine(db, 'settlement', a.id)
    const read = createSettlementObserver(
      {
        chainId: 8453,
        asset: USDC,
        finality: 'finalized',
        minConfirmations: 1,
        maxBlockAgeMs: 1800000,
        sourceId:
          realm === 'operator_rpc'
            ? 'configured_registry_rpc'
            : 'LOCAL_SIMULATION_ONLY',
      },
      rpc,
      clock,
    )
    const proof = await read(
      {
        authorizationKey: a.authorization_key!,
        authorizationFingerprint: a.authorization_fingerprint!,
        payer: a.buyer_address!,
        recipient: a.recipient,
        amount: a.amount_atomic,
        asset: USDC,
        network: NETWORK,
      },
      transaction,
    )
    if (proof.authorizationNonce !== a.authorization_nonce)
      unavailable('authorization_evidence_mismatch')
    const report = await db
      .prepare(
        'SELECT transaction_hash FROM payment_submission_reports WHERE attempt_id=?',
      )
      .bind(a.id)
      .first<{ transaction_hash: string | null }>()
    if (
      report?.transaction_hash &&
      report.transaction_hash.toLowerCase() !== proof.transaction
    ) {
      await quarantine(
        db,
        'settlement',
        a.id,
        'report_transaction_conflict',
        await clock(),
      )
      unavailable('payment_evidence_quarantined')
    }
    const identity = {
      transaction: proof.transaction,
      blockNumber: proof.blockNumber,
      blockHash: proof.blockHash,
      nonce: proof.authorizationNonce,
      authorizationKey: proof.authorizationKey,
      fingerprint: proof.authorizationFingerprint,
      payer: proof.payer,
      recipient: proof.recipient,
      amount: proof.amount,
      asset: proof.asset,
      network: proof.network,
    }
    const checkpoint = await persistEvidence(
      db,
      'settlement',
      a.id,
      realm,
      {
        identity,
        finalizedNumber: proof.finalizedBlockNumber,
        finalizedHash: proof.finalizedBlockHash,
        details: proof,
      },
      rpc,
      clock,
    )
    await store.finalize(a, checkpoint, proof)
  }
  async function fulfill(a: ActivationAttempt, s: ActiveResource) {
    if (!(await store.fulfillment(a, s)))
      throw new GatewayError(409, 'delivery_already_claimed_or_disabled')
    try {
      const receipt = await store.receipt(a.id)
      if (
        !receipt ||
        receipt.evidence_kind !==
          (realm === 'operator_rpc' ? 'confirmed_onchain' : 'local_simulation')
      )
        unavailable('receipt_unavailable')
      // Re-observe the exact stored transaction. No SDK report or D1 flag alone releases content.
      const read = createSettlementObserver(
        {
          chainId: 8453,
          asset: USDC,
          finality: 'finalized',
          minConfirmations: 1,
          maxBlockAgeMs: 1800000,
          sourceId:
            realm === 'operator_rpc'
              ? 'configured_registry_rpc'
              : 'LOCAL_SIMULATION_ONLY',
        },
        rpc,
        clock,
      )
      const proof = await read(
        {
          authorizationKey: a.authorization_key!,
          authorizationFingerprint: a.authorization_fingerprint!,
          payer: a.buyer_address!,
          recipient: a.recipient,
          amount: a.amount_atomic,
          asset: USDC,
          network: NETWORK,
        },
        receipt.transaction_hash,
      )
      if (proof.authorizationNonce !== a.authorization_nonce)
        unavailable('authorization_evidence_mismatch')
      await persistEvidence(
        db,
        'settlement',
        a.id,
        realm,
        {
          identity: {
            transaction: proof.transaction,
            blockNumber: proof.blockNumber,
            blockHash: proof.blockHash,
            nonce: proof.authorizationNonce,
            authorizationKey: proof.authorizationKey,
            fingerprint: proof.authorizationFingerprint,
            payer: proof.payer,
            recipient: proof.recipient,
            amount: proof.amount,
            asset: proof.asset,
            network: proof.network,
          },
          finalizedNumber: proof.finalizedBlockNumber,
          finalizedHash: proof.finalizedBlockHash,
          details: proof,
        },
        rpc,
        clock,
      )
      const current = await unchanged(a)
      const data = {
        ...internalDocument({
          resourceId: a.resource_id,
          amountAtomic: a.amount_atomic,
          payTo: a.recipient,
          registryVersion: a.config_version,
          configurationCommitment: a.config_hash,
        }),
        ...(realm === 'local_simulation' ? { localSimulationOnly: true } : {}),
      }
      if (!(await store.fulfillment(a, current, true)))
        unavailable('delivery_configuration_changed')
      return response(
        200,
        {
          data,
          ...(realm === 'local_simulation'
            ? { localSimulationOnly: true }
            : {}),
        },
        {
          'PAYMENT-RESPONSE': encodePaymentResponseHeader(
            JSON.parse(receipt.settlement_json) as SettleResponse,
          ),
        },
      )
    } catch (error) {
      await store.deliveryFailed(a).catch(() => {})
      throw error
    }
  }
  async function deliver(a: ActivationAttempt) {
    try {
      return await fulfill(a, await unchanged(a))
    } catch (error) {
      // Recovery has the same paid-but-unfulfilled semantics as the initial request.
      await store
        .advance(
          a.id,
          'settled',
          'fulfillment_failed',
          'paid_delivery_unavailable',
        )
        .catch(() => {})
      throw error
    }
  }
  return async (request: Request): Promise<Response> => {
    let active: ActivationAttempt | null = null,
      claimed = false,
      submitted = false
    try {
      const meta = await db.prepare('SELECT 1').all()
      if (
        typeof meta.meta.served_by !== 'string' ||
        !meta.meta.served_by ||
        (meta.meta.served_by === 'miniflare.db') !==
          (realm === 'local_simulation')
      )
        unavailable('payment_realm_unavailable')
      if (!Number.isSafeInteger(await clock()))
        unavailable('payment_clock_unavailable')
      const url = new URL(request.url)
      if (
        url.origin !== origin ||
        (realm === 'operator_rpc' && origin !== 'https://gate.signalarc.fun')
      )
        throw new GatewayError(404, 'payment_route_unavailable')
      if (request.method !== 'GET') throw new GatewayError(405, 'get_only')
      if (
        request.headers.has('Origin') &&
        request.headers.get('Origin') !== origin
      )
        throw new GatewayError(403, 'origin_rejected')
      let bytes = 0
      request.headers.forEach(
        (v, k) => (bytes += new TextEncoder().encode(k + v).length),
      )
      if (
        bytes > 16384 ||
        request.body ||
        (request.headers.has('Content-Length') &&
          request.headers.get('Content-Length') !== '0')
      )
        throw new GatewayError(413, 'request_limit')
      if (request.url.length > 2048)
        throw new GatewayError(414, 'request_limit')
      const resource = url.pathname.match(/^\/api\/pay\/([a-f0-9-]{36})$/)?.[1]
      if (!resource) throw new GatewayError(404, 'resource_not_found')
      if (url.searchParams.getAll('transaction').length > 1)
        throw new GatewayError(400, 'invalid_transaction_hint')
      const candidate = url.searchParams.get('transaction')
      url.searchParams.delete('transaction')
      if (candidate !== null && !txHash(candidate))
        throw new GatewayError(400, 'invalid_transaction_hint')
      if (
        [...url.searchParams.keys()].some(
          (k) => !['attempt', 'ticket'].includes(k),
        ) ||
        [...url.searchParams.keys()].some(
          (k) => url.searchParams.getAll(k).length !== 1,
        )
      )
        throw new GatewayError(400, 'invalid_ticket')
      const header = request.headers.get('PAYMENT-SIGNATURE')
      if (header && header.length > 8192)
        throw new GatewayError(413, 'payment_header_limit')
      if (!url.search && header) {
        const issued = new URL(issuedResourceUrl(header))
        if (
          issued.origin !== origin ||
          issued.pathname !== url.pathname ||
          [...issued.searchParams.keys()].some(
            (k) => !['attempt', 'ticket'].includes(k),
          ) ||
          issued.searchParams.getAll('attempt').length !== 1 ||
          issued.searchParams.getAll('ticket').length !== 1
        )
          throw new GatewayError(400, 'issued_ticket_required')
        url.search = issued.search
      }
      const id = url.searchParams.get('attempt'),
        ticket = url.searchParams.get('ticket')
      if (!id) {
        if (header || ticket || candidate)
          throw new GatewayError(400, 'issued_ticket_required')
        const s = await eligible(resource)
        const supported = await deadline(() => facilitator.getSupported(), 8000)
        if (
          !supported?.kinds?.some(
            (k) =>
              k.x402Version === 2 &&
              k.scheme === 'exact' &&
              k.network === NETWORK,
          ) ||
          !supported.extensions?.includes('builder-code')
        )
          unavailable('facilitator_capability_unavailable')
        const required: PaymentRequirements = {
          scheme: 'exact',
          network: NETWORK,
          asset: USDC,
          amount: s.manifest.amount_atomic,
          payTo: s.manifest.recipient,
          maxTimeoutSeconds: 60,
          extra: {
            name: 'USD Coin',
            version: '2',
            assetTransferMethod: 'eip3009',
            paymentFlow: 'upfront',
          },
        }
        const attempt = crypto.randomUUID(),
          token = randomToken()
        url.searchParams.set('attempt', attempt)
        url.searchParams.set('ticket', token)
        await store.create(attempt, s, token, url.href, required)
        const last = await currentResource(db, resource, realm, clock)
        if (last.hash !== s.hash) unavailable('resource_admission_changed')
        const challenge = {
          x402Version: 2 as const,
          resource: info(url.href),
          accepts: [required],
          extensions: signalArcBuilderDeclaration(8453),
        }
        return response(402, challenge, {
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge),
        })
      }
      if (
        !/^[a-f0-9-]{36}$/.test(id) ||
        !ticket ||
        !/^[a-f0-9]{64}$/.test(ticket)
      )
        throw new GatewayError(400, 'invalid_ticket')
      active = await store.get(id)
      if (
        !active ||
        active.resource_id !== resource ||
        active.request_hash !== (await hash(ticket)) ||
        active.url_hash !== (await hash(url.href))
      )
        throw new GatewayError(404, 'payment_attempt_not_found')
      await store.recover(active)
      active = (await store.get(id))!
      if (!header) {
        if (active.phase !== 'created' || active.expires_at <= (await clock()))
          throw new GatewayError(409, 'attempt_not_payable')
        await unchanged(active)
        const challenge = {
          x402Version: 2 as const,
          resource: info(url.href),
          accepts: [
            JSON.parse(active.requirements_json) as PaymentRequirements,
          ],
          extensions: signalArcBuilderDeclaration(8453),
        }
        return response(402, challenge, {
          'PAYMENT-REQUIRED': encodePaymentRequiredHeader(challenge),
        })
      }
      const signed = await payment(
        header,
        JSON.parse(active.requirements_json),
        url.href,
        info(url.href),
      )
      if (!validSignalArcBuilderEcho(signed.payload.extensions))
        throw new GatewayError(402, 'builder_extension_required')
      if (active.updated_at > (await clock()))
        unavailable('payment_clock_unavailable')
      if (active.phase !== 'created') {
        if (
          active.authorization_key !== signed.identity ||
          active.authorization_fingerprint !== signed.fingerprint
        )
          throw new GatewayError(409, 'authorization_replay')
        if (['settled', 'fulfillment_failed'].includes(active.phase))
          return await deliver(active)
        if (
          ['settlement_pending', 'settlement_unknown'].includes(active.phase)
        ) {
          const report = await db
            .prepare(
              'SELECT transaction_hash FROM payment_submission_reports WHERE attempt_id=?',
            )
            .bind(active.id)
            .first<{ transaction_hash: string | null }>()
          const transaction = report?.transaction_hash ?? candidate
          if (transaction) {
            try {
              await finalized(active, transaction)
            } catch {
              return response(
                202,
                { paymentStatus: 'settlement_requires_reconciliation' },
                { 'Retry-After': '30' },
              )
            }
            return response(
              202,
              { paymentStatus: 'settled_delivery_pending' },
              { 'Retry-After': '1' },
            )
          }
          return response(
            202,
            { paymentStatus: 'settlement_requires_reconciliation' },
            { 'Retry-After': '30' },
          )
        }
        throw new GatewayError(409, 'authorization_already_used')
      }
      if (
        active.expires_at <= (await clock()) ||
        !authorizationFresh(signed.a, await clock())
      )
        throw new GatewayError(402, 'authorization_expired')
      const valid = await verifyTypedData({
        address: signed.payer as Hex,
        domain: {
          name: 'USD Coin',
          version: '2',
          chainId: 8453,
          verifyingContract: USDC,
        },
        types: {
          TransferWithAuthorization: [
            { name: 'from', type: 'address' },
            { name: 'to', type: 'address' },
            { name: 'value', type: 'uint256' },
            { name: 'validAfter', type: 'uint256' },
            { name: 'validBefore', type: 'uint256' },
            { name: 'nonce', type: 'bytes32' },
          ],
        },
        primaryType: 'TransferWithAuthorization',
        message: {
          from: signed.a.from as Hex,
          to: signed.a.to as Hex,
          value: BigInt(signed.a.value),
          validAfter: BigInt(signed.a.validAfter),
          validBefore: BigInt(signed.a.validBefore),
          nonce: signed.a.nonce as Hex,
        },
        signature: signed.payload.payload.signature as Hex,
      })
      if (!valid)
        throw new GatewayError(402, 'signature_invalid_or_unsupported')
      await unchanged(active)
      if (
        !(await store.claim(
          active,
          signed.identity,
          signed.fingerprint,
          signed.payer,
          signed.a.nonce.toLowerCase(),
        ))
      )
        throw new GatewayError(409, 'authorization_already_claimed')
      claimed = true
      active = (await store.get(id))!
      const verified = await deadline(
        () =>
          facilitator.verify(
            structuredClone(signed.payload),
            JSON.parse(active!.requirements_json),
          ),
        8000,
      )
      if (!validVerification(verified, signed.payer)) {
        await store.advance(
          id,
          'verifying',
          'rejected',
          'verification_rejected',
        )
        throw new GatewayError(402, 'verification_rejected')
      }
      await unchanged(active)
      if (!(await store.advance(id, 'verifying', 'verified')))
        throw new GatewayError(409, 'verification_raced')
      await sameSnapshot(active)
      if (
        active.expires_at <= (await clock()) ||
        !authorizationFresh(signed.a, await clock()) ||
        !(await store.advance(id, 'verified', 'settlement_pending'))
      )
        throw new GatewayError(409, 'settlement_claim_raced')
      await sameSnapshot(active)
      let transaction: string | null = null
      if (!(await store.submissionPermit(active)))
        throw new GatewayError(409, 'settlement_submission_not_permitted')
      submitted = true
      try {
        const result = await deadline(
          () =>
            facilitator.settle(
              structuredClone(signed.payload),
              JSON.parse(active!.requirements_json),
            ),
          10000,
        )
        if (
          validSettlement(
            result,
            signed.payer,
            active.amount_atomic,
            active.recipient,
          )
        )
          transaction = result.transaction
      } catch {
        /* Submitted outcome is unknown; never retry settlement. */
      }
      await store.report(active, transaction)
      if (!transaction) {
        await store.advance(
          id,
          'settlement_pending',
          'settlement_unknown',
          'settlement_report_unknown',
        )
        return response(
          202,
          { paymentStatus: 'settlement_requires_reconciliation' },
          { 'Retry-After': '30' },
        )
      }
      try {
        await finalized(active, transaction)
      } catch {
        return response(
          202,
          { paymentStatus: 'settlement_pending_finality' },
          { 'Retry-After': '30' },
        )
      }
      return response(
        202,
        { paymentStatus: 'settled_delivery_pending' },
        { 'Retry-After': '1' },
      )
    } catch (error) {
      if (active && claimed && !submitted) {
        for (const from of ['verifying', 'verified', 'settlement_pending'])
          await store
            .advance(active.id, from, 'failed', 'aborted_before_submission')
            .catch(() => {})
      }
      if (active && submitted)
        await store
          .advance(
            active.id,
            'settlement_pending',
            'settlement_unknown',
            'submission_outcome_unknown',
          )
          .catch(() => {})
      if (active && claimed && submitted)
        await store
          .advance(
            active.id,
            'settled',
            'fulfillment_failed',
            'paid_delivery_unavailable',
          )
          .catch(() => {})
      return response(error instanceof GatewayError ? error.status : 503, {
        error:
          error instanceof GatewayError
            ? error.code
            : 'payment_service_unavailable',
      })
    }
  }
}
