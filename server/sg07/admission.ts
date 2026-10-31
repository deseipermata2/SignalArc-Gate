import { resourceInput } from '../../shared/resources'
import { hash } from '../sg03/http'
import { boundedJson, canonical, GatewayError } from '../sg05/bounds'
import { clockTime, type TrustedClock } from '../sg05/clock'
import { commitment, resourceId } from '../sg05/registry'
import {
  createRegistryReader,
  validateRegistryPolicy,
  type ExpectedResource,
  type RegistryPolicy,
  type RegistryRpc,
} from './registry'

export interface ReviewSource {
  kind: 'local_simulation' | 'untrusted_rpc'
  id: string
}
/** Internal observation/review ONLY. No production-authority constructor or promote method exists. */
export function createRegistryReview(
  db: D1Database,
  policy: RegistryPolicy,
  source: ReviewSource,
  rpc: RegistryRpc,
  clock: TrustedClock,
) {
  const p = Object.freeze(validateRegistryPolicy(policy))
  if (
    !['local_simulation', 'untrusted_rpc'].includes(source.kind) ||
    !/^[a-zA-Z0-9_-]{1,64}$/.test(source.id)
  )
    throw new GatewayError(503, 'registry_review_source_invalid')
  const provenance = source.kind,
    sourceId = source.id
  return async (uuid: string) => {
    if (!/^[a-f0-9-]{36}$/.test(uuid))
      throw new GatewayError(422, 'invalid_resource_id')
    const captured = await db
      .prepare(
        `SELECT r.*,m.wallet_address AS owner,b.original_owner,b.onchain_resource_id,b.registry_address,b.config_salt,b.config_hash,b.registry_version,b.source,b.generation FROM api_resources r JOIN merchants m ON m.id=r.merchant_id LEFT JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=?`,
      )
      .bind(uuid)
      .first<Record<string, unknown>>()
    if (!captured) throw new GatewayError(404, 'resource_not_found')
    const reads: { method: string; digest?: string; failed?: boolean }[] = []
    const read = createRegistryReader(
      p,
      async (method, params, signal) => {
        try {
          const value = await rpc(method, params, signal)
          const serialized = canonical(value)
          boundedJson(serialized, 131072, 65536)
          reads.push({ method, digest: await hash(serialized) })
          return value
        } catch (error) {
          reads.push({ method, failed: true })
          throw error
        }
      },
      clock,
    )
    let candidate: Awaited<ReturnType<typeof read>> | undefined
    let failure: string | null = null
    try {
      if (
        !captured.generation ||
        !['unconfirmed', 'local_simulation'].includes(String(captured.source))
      )
        throw new GatewayError(503, 'registry_binding_unconfirmed')
      if (
        captured.registry_address !== null &&
        String(captured.registry_address).toLowerCase() !==
          p.address.toLowerCase()
      )
        throw new GatewayError(503, 'registry_binding_address_mismatch')
      const resource = resourceInput({
        name: captured.name,
        upstreamUrl: captured.upstream_url,
        responseConfig: JSON.parse(String(captured.response_config)),
        priceAtomic: captured.price_atomic,
        payoutAddress: captured.payout_address,
        network: captured.network,
        enabled: captured.enabled === 1,
      })
      const id = resourceId(String(captured.original_owner), uuid)
      const configHash = commitment(
        id,
        resource.upstreamUrl,
        resource.responseConfig.maxBytes,
        String(captured.config_salt),
      )
      if (
        id !== captured.onchain_resource_id ||
        configHash !== captured.config_hash
      )
        throw new GatewayError(503, 'registry_binding_commitment_mismatch')
      const expected: ExpectedResource = {
        uuid,
        originalOwner: String(captured.original_owner),
        currentOwner: String(captured.owner),
        payout: resource.payoutAddress,
        priceAtomic: resource.priceAtomic,
        version: String(captured.registry_version),
        configHash,
        enabled: resource.enabled,
      }
      candidate = await read(expected)
    } catch (error) {
      failure =
        error instanceof GatewayError
          ? error.code
          : 'registry_observation_invalid'
    }
    const now = await clockTime(clock),
      id = crypto.randomUUID()
    const block = candidate?.blockNumber ?? null,
      blockHash = candidate?.blockHash ?? null
    const payload = canonical({
      productionAdmitted: false,
      policy: p,
      resourceId: uuid,
      originalOwner: captured.original_owner,
      owner: captured.owner,
      priceAtomic: captured.price_atomic,
      payout: captured.payout_address,
      configHash: captured.config_hash,
      version: captured.registry_version,
      observation: candidate,
      reads,
      error: failure,
    })
    const requested = failure
      ? failure.includes('timeout') ||
        failure.includes('rpc') ||
        failure === 'registry_unavailable'
        ? 'rpc_failure'
        : 'rejected'
      : 'review_only'
    // SQL evaluates live revision/generation and watermarks once, at insertion. Triggers invalidate atomically.
    const [insert, result] = await db.batch<Record<string, unknown>>([
      db
        .prepare(
          `INSERT INTO registry_evidence_journal (id,kind,resource_id,observed_at,provenance,source_id,resource_revision,binding_generation,registry_address,runtime_code_hash,block_number,block_hash,payload_json,outcome)
      SELECT ?,'observation',?,?,?,?,?,?,?,?,?,?,?,CASE
        WHEN NOT EXISTS(SELECT 1 FROM api_resources r WHERE r.id=? AND r.payment_revision=?) OR
          b.generation IS NOT ? THEN 'raced'
        WHEN EXISTS(SELECT 1 FROM registry_evidence_journal q WHERE q.resource_id=? AND q.kind='observation' AND q.outcome='conflict') THEN 'conflict'
        WHEN ? != 'review_only' THEN ?
        WHEN b.review_conflicted=1 THEN 'conflict'
        WHEN b.review_registry_address IS NOT NULL AND (lower(b.review_registry_address)!=lower(?) OR b.review_code_hash!=?) THEN 'conflict'
        WHEN b.review_block_number IS NOT NULL AND (length(?)<length(b.review_block_number) OR (length(?)=length(b.review_block_number) AND ?<b.review_block_number)) THEN 'replay'
        WHEN b.review_block_number=? AND b.review_block_hash!=? THEN 'conflict'
        WHEN b.review_block_number=? THEN 'replay'
        ELSE 'review_only' END
      FROM (SELECT 1) LEFT JOIN resource_registry_bindings b ON b.resource_id=?`,
        )
        .bind(
          id,
          uuid,
          now,
          provenance,
          sourceId,
          Number(captured.payment_revision),
          captured.generation ?? null,
          p.address,
          p.runtimeCodeHash,
          block,
          blockHash,
          payload,
          uuid,
          Number(captured.payment_revision),
          captured.generation ?? null,
          uuid,
          requested,
          requested,
          p.address,
          p.runtimeCodeHash,
          block,
          block,
          block,
          block,
          blockHash,
          block,
          uuid,
        ),
      db
        .prepare('SELECT id,outcome FROM registry_evidence_journal WHERE id=?')
        .bind(id),
    ])
    if (insert.meta.changes < 1 || result.results.length !== 1)
      throw new GatewayError(503, 'registry_review_unavailable')
    return { ...result.results[0], productionAdmitted: false as const }
  }
}
