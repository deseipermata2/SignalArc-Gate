import { internalDocument } from '../payments/document'
import { resourceInput } from '../../shared/resources'
import { hash } from '../sg03/http'
import { boundedJson, canonical, GatewayError } from '../sg05/bounds'
import { validSettlement } from '../sg05/protocol'
import {
  commitment,
  resourceId,
  NETWORK,
  USDC,
  type Snapshot,
} from '../sg05/registry'
import type { UpstreamAccess } from '../sg05/upstream'

import {
  assertLocalManifest,
  localPilotManifest,
  type LocalPilotAuthority,
} from './internal-manifest'

interface LocalPilotProfile {
  origin: string
  appEnv: string
  optIn: boolean
  pagesUrl: string
}
function deny(): never {
  throw new GatewayError(503, 'internal_json_pilot_unavailable')
}
function freeze<T>(v: T): T {
  if (v && typeof v === 'object') {
    for (const child of Object.values(v)) freeze(child)
    Object.freeze(v)
  }
  return v
}
/**
 * One fixed owner-controlled configuration-document handler. No HTTP/DNS/proxy
 * capability, public constructor route, production authority or shared mutable permit.
 * The HTTPS URL is an existing commitment identifier and is never dereferenced.
 */
export async function createLocalInternalJsonPilot(
  db: D1Database,
  profile: LocalPilotProfile,
  approved: Snapshot,
  attemptId: string | null,
  authority: LocalPilotAuthority,
): Promise<UpstreamAccess> {
  const origin = new URL(profile.origin)
  if (
    profile.appEnv !== 'local' ||
    !profile.optIn ||
    origin.protocol !== 'http:' ||
    origin.hostname !== '127.0.0.1' ||
    origin.origin !== profile.origin ||
    !['127.0.0.1', 'localhost'].includes(new URL(profile.pagesUrl).hostname)
  )
    deny()
  if ((await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db')
    deny()
  const entry = freeze(boundedJson(canonical(approved)) as Snapshot)
  const input = resourceInput(entry.resource)
  const derived = resourceId(entry.binding.original_owner, entry.id)
  const expectedHash = await hash(
    canonical({
      ...entry,
      hash: undefined,
      binding: { ...entry.binding, checked_at: undefined },
    }),
  )
  if (
    !input.enabled ||
    input.network !== NETWORK ||
    entry.binding.source !== 'local_simulation' ||
    entry.binding.registry_address !== null ||
    entry.hash !== expectedHash ||
    entry.binding.onchain_resource_id !== derived ||
    commitment(
      derived,
      input.upstreamUrl,
      input.responseConfig.maxBytes,
      entry.binding.config_salt,
    ) !== entry.binding.config_hash
  )
    deny()
  const manifest = freeze(localPilotManifest(entry))
  const admission = () => assertLocalManifest(authority, manifest)
  await admission()
  const assertEligible = async (s: Snapshot) => {
    await admission()
    if (
      s.id !== entry.id ||
      s.merchantId !== entry.merchantId ||
      s.owner !== entry.owner ||
      s.hash !== entry.hash ||
      s.revision !== entry.revision ||
      s.binding.generation !== entry.binding.generation ||
      canonical(s.resource) !== canonical(entry.resource) ||
      canonical({ ...s.binding, checked_at: undefined }) !==
        canonical({ ...entry.binding, checked_at: undefined })
    )
      deny()
  }
  return {
    assertEligible,
    async validateLocalSettlement(attempt, result) {
      // Evidence survives revocation: this check validates only payment evidence,
      // not current delivery permission. Eligibility is checked separately.
      await authority.verifySettlement(attempt, result)
    },
    async request(url, init) {
      await admission()
      const headers = new Headers(init.headers)
      if (
        url !== entry.resource.upstreamUrl ||
        init.method !== 'GET' ||
        init.redirect !== 'manual' ||
        init.cache !== 'no-store' ||
        init.body ||
        'credentials' in init ||
        !init.signal ||
        init.signal.aborted ||
        [...headers.keys()].join(',') !== 'accept' ||
        headers.get('Accept') !== 'application/json' ||
        !attemptId
      )
        deny()
      // An internal direct call cannot obtain content from an unpaid, unknown,
      // failed, replayed or differently bound attempt, even outside the gateway.
      const paid = await db
        .prepare(
          `SELECT a.buyer_address,p.settlement_json,p.transaction_hash FROM payment_attempts a
        JOIN payment_receipts p ON p.attempt_id=a.id
        JOIN api_resources r ON r.id=a.resource_id AND r.merchant_id=a.merchant_id
        JOIN resource_registry_bindings b ON b.resource_id=r.id
        WHERE a.id=? AND a.phase='fulfilling' AND a.evidence_kind='local_simulation'
        AND p.evidence_kind='local_simulation' AND p.authorization_key=a.authorization_key
        AND p.config_version=a.config_version AND p.config_hash=a.config_hash
        AND a.resource_id=? AND a.merchant_id=? AND a.snapshot_hash=?
        AND a.config_revision=? AND a.binding_generation=?
        AND a.config_version=? AND a.config_hash=? AND a.network=? AND lower(a.asset)=lower(?)
        AND a.amount_atomic=? AND lower(a.recipient)=lower(?)
        AND p.amount_atomic=a.amount_atomic AND lower(p.payout_address)=lower(a.recipient)
        AND lower(p.payer_address)=lower(a.buyer_address) AND p.network=a.network
        AND r.enabled=1 AND r.payment_revision=a.config_revision
        AND b.source='local_simulation' AND b.generation=a.binding_generation`,
        )
        .bind(
          attemptId,
          entry.id,
          entry.merchantId,
          entry.hash,
          entry.revision,
          entry.binding.generation,
          entry.binding.registry_version,
          entry.binding.config_hash,
          NETWORK,
          USDC,
          entry.resource.priceAtomic,
          entry.resource.payoutAddress,
        )
        .first<{
          buyer_address: string
          settlement_json: string
          transaction_hash: string
        }>()
      if (
        !paid ||
        (boundedJson(paid.settlement_json) as { transaction?: string })
          .transaction !== paid.transaction_hash ||
        !validSettlement(
          boundedJson(paid.settlement_json),
          paid.buyer_address,
          entry.resource.priceAtomic,
          entry.resource.payoutAddress,
        ) ||
        init.signal.aborted
      )
        deny()
      await admission()
      // Real server-owned integration metadata, not invented usage or payment activity.
      return Response.json(
        {
          localSimulationOnly: true,
          ...internalDocument({
            resourceId: entry.id,
            amountAtomic: entry.resource.priceAtomic,
            payTo: entry.resource.payoutAddress,
            registryVersion: entry.binding.registry_version,
            configurationCommitment: entry.binding.config_hash,
          }),
        },
        {
          headers: {
            'Cache-Control': 'private, no-store, max-age=0',
            'X-SignalArc-Mode': 'LOCAL SIMULATION ONLY',
          },
        },
      )
    },
  }
}
