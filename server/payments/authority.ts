import { internalDocument } from './document'
import type { PaymentDatabase } from './config'
import { resourceInput } from '../../shared/resources'
import { hash } from '../sg03/http'
import { boundedJson, canonical, GatewayError } from '../sg05/bounds'
import { commitment, resourceId, NETWORK, USDC } from '../sg05/registry'
import { createRegistryReader, type RegistryRpc } from '../sg07/registry'
import { deployment } from '../registry/status'
import { POLICY_ID } from './config'

export type Realm = 'operator_rpc' | 'local_simulation'
export type Clock = () => Promise<number>
export interface Manifest {
  resource_id: string
  merchant_id: string
  policy_id: string
  handler: string
  realm: Realm
  owner: string
  original_owner: string
  onchain_resource_id: string
  registry_address: string
  runtime_code_hash: string
  config_hash: string
  registry_version: string
  resource_revision: number
  binding_generation: number
  amount_atomic: string
  recipient: string
  approved_at: number
  expires_at: number
  revoked_at: number | null
}
export interface ActiveResource {
  manifest: Manifest
  hash: string
  resource: ReturnType<typeof resourceInput>
}
export function unavailable(code: string): never {
  throw new GatewayError(503, code)
}
export async function quarantine(
  db: PaymentDatabase,
  scope: string,
  id: string,
  reason: string,
  now: number,
) {
  await db
    .prepare(
      'INSERT INTO payment_quarantine(scope,scope_id,reason,created_at) SELECT ?,?,?,? WHERE NOT EXISTS(SELECT 1 FROM payment_quarantine WHERE scope=? AND scope_id=?)',
    )
    .bind(scope, id, reason, now, scope, id)
    .run()
}
export async function checkQuarantine(
  db: PaymentDatabase,
  scope: string,
  id: string,
) {
  if (
    await db
      .prepare('SELECT 1 FROM payment_quarantine WHERE scope=? AND scope_id=?')
      .bind(scope, id)
      .first()
  )
    unavailable('payment_evidence_quarantined')
}
export async function currentResource(
  db: PaymentDatabase,
  id: string,
  realm: Realm,
  clock: Clock,
): Promise<ActiveResource> {
  const now = await clock()
  const m = await db
    .prepare('SELECT * FROM payment_manifests WHERE resource_id=?')
    .bind(id)
    .first<Manifest>()
  if (
    !m ||
    m.realm !== realm ||
    m.policy_id !== POLICY_ID ||
    m.handler !== 'signalarc.resource-configuration.v1' ||
    m.revoked_at !== null ||
    m.expires_at <= now ||
    m.approved_at > now + 1000 ||
    m.expires_at - m.approved_at > 30 * 86400000 ||
    m.registry_address.toLowerCase() !== deployment.address.toLowerCase() ||
    m.runtime_code_hash !== deployment.runtimeCodeHash
  )
    unavailable('resource_admission_unavailable')
  await checkQuarantine(db, 'registry', id)
  const row = await db
    .prepare(
      `SELECT r.*,b.registry_address,b.original_owner,b.onchain_resource_id,b.config_salt,b.config_hash,b.registry_version,b.generation,b.review_conflicted,m.wallet_address AS owner,EXISTS(SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=r.id AND j.outcome='conflict') AS quarantined FROM api_resources r JOIN merchants m ON m.id=r.merchant_id JOIN resource_registry_bindings b ON b.resource_id=r.id WHERE r.id=? AND r.merchant_id=?`,
    )
    .bind(id, m!.merchant_id)
    .first<Record<string, unknown>>()
  if (
    !row ||
    row.quarantined !== 0 ||
    row.review_conflicted !== 0 ||
    String(row.owner).toLowerCase() !== m!.owner.toLowerCase() ||
    String(row.registry_address).toLowerCase() !==
      m!.registry_address.toLowerCase() ||
    String(row.original_owner).toLowerCase() !==
      m!.original_owner.toLowerCase() ||
    row.onchain_resource_id !== m!.onchain_resource_id ||
    row.config_hash !== m!.config_hash ||
    row.registry_version !== m!.registry_version ||
    row.payment_revision !== m!.resource_revision ||
    row.generation !== m!.binding_generation ||
    row.enabled !== 1
  )
    unavailable('resource_admission_changed')
  const resource = resourceInput({
    name: row!.name,
    upstreamUrl: row!.upstream_url,
    responseConfig: boundedJson(String(row!.response_config)),
    priceAtomic: row!.price_atomic,
    payoutAddress: row!.payout_address,
    network: row!.network,
    enabled: true,
  })
  const derived = resourceId(m!.original_owner, id)
  if (
    derived !== m!.onchain_resource_id ||
    commitment(
      derived,
      resource.upstreamUrl,
      resource.responseConfig.maxBytes,
      String(row!.config_salt),
    ) !== m!.config_hash ||
    resource.priceAtomic !== m!.amount_atomic ||
    resource.payoutAddress.toLowerCase() !== m!.recipient.toLowerCase() ||
    resource.network !== NETWORK
  )
    unavailable('resource_admission_changed')
  if (
    new TextEncoder().encode(
      JSON.stringify({
        data: internalDocument({
          resourceId: id,
          amountAtomic: m!.amount_atomic,
          payTo: m!.recipient,
          registryVersion: m!.registry_version,
          configurationCommitment: m!.config_hash,
        }),
      }),
    ).length > resource.responseConfig.maxBytes
  )
    unavailable('internal_json_limit')
  return { manifest: m!, resource, hash: await hash(canonical(m)) }
}
export interface ChainEvidence {
  identity: unknown
  finalizedNumber: string
  finalizedHash: string
  details: unknown
}
/** Stable receipt/config identity is independent of normally advancing finality anchors. */
export async function persistEvidence(
  db: PaymentDatabase,
  scope: 'registry' | 'settlement',
  id: string,
  realm: Realm,
  e: ChainEvidence,
  rpc: RegistryRpc,
  clock: Clock,
) {
  const number = BigInt(e.finalizedNumber)
  if (number < 0n || number > 9223372036854775807n)
    unavailable('evidence_block_invalid')
  const identity = canonical(e.identity)
  for (let retry = 0; retry < 2; retry++) {
    await checkQuarantine(db, scope, id)
    const prior = await db
      .prepare(
        'SELECT id,identity_json,finalized_number,finalized_hash FROM payment_chain_evidence WHERE scope=? AND scope_id=? ORDER BY CAST(finalized_number AS INTEGER) DESC,observed_at DESC,id DESC LIMIT 1',
      )
      .bind(scope, id)
      .first<{
        id: string
        identity_json: string
        finalized_number: string
        finalized_hash: string
      }>()
    if (prior) {
      if (number < BigInt(prior.finalized_number))
        unavailable('evidence_superseded')
      let conflict =
        prior.identity_json !== identity ||
        (number === BigInt(prior.finalized_number) &&
          prior.finalized_hash !== e.finalizedHash)
      if (!conflict && number > BigInt(prior.finalized_number)) {
        const old = (await rpc(
          'eth_getBlockByNumber',
          ['0x' + BigInt(prior.finalized_number).toString(16), false],
          new AbortController().signal,
        )) as { hash?: string; number?: string }
        conflict =
          old?.hash?.toLowerCase() !== prior.finalized_hash ||
          old.number !== '0x' + BigInt(prior.finalized_number).toString(16)
      }
      if (conflict) {
        await quarantine(
          db,
          scope,
          id,
          'conflicting_canonical_evidence',
          await clock(),
        )
        unavailable('payment_evidence_quarantined')
      }
    }
    const entryId = crypto.randomUUID()
    const inserted = await db
      .prepare(
        `INSERT INTO payment_chain_evidence(id,scope,scope_id,realm,identity_json,finalized_number,finalized_hash,observed_at,evidence_json) SELECT ?,?,?,?,?,?,?,?,? WHERE (SELECT id FROM payment_chain_evidence WHERE scope=? AND scope_id=? ORDER BY CAST(finalized_number AS INTEGER) DESC,observed_at DESC,id DESC LIMIT 1) IS ? AND NOT EXISTS(SELECT 1 FROM payment_quarantine WHERE scope=? AND scope_id=?)`,
      )
      .bind(
        entryId,
        scope,
        id,
        realm,
        identity,
        e.finalizedNumber,
        e.finalizedHash,
        await clock(),
        canonical(e.details),
        scope,
        id,
        prior?.id ?? null,
        scope,
        id,
      )
      .run()
    if (inserted.meta.changes === 1) return entryId
  }
  unavailable('evidence_concurrency_retry')
}
export async function eligibleResource(
  db: PaymentDatabase,
  id: string,
  realm: Realm,
  rpc: RegistryRpc,
  clock: Clock,
) {
  const before = await currentResource(db, id, realm, clock),
    m = before.manifest
  const read = createRegistryReader(
    {
      chainId: 8453,
      asset: USDC,
      address: deployment.address.toLowerCase(),
      runtimeCodeHash: deployment.runtimeCodeHash,
      finality: 'finalized',
      minConfirmations: 1,
      maxBlockAgeMs: 1800000,
    },
    rpc,
    clock,
  )
  const observed = await read({
    uuid: id,
    originalOwner: m.original_owner,
    currentOwner: m.owner,
    payout: m.recipient,
    priceAtomic: m.amount_atomic,
    configHash: m.config_hash,
    version: m.registry_version,
    enabled: true,
  })
  await persistEvidence(
    db,
    'registry',
    id,
    realm,
    {
      identity: {
        resourceId: m.onchain_resource_id,
        owner: m.owner,
        payout: m.recipient,
        amount: m.amount_atomic,
        version: m.registry_version,
        configHash: m.config_hash,
        registry: deployment.address,
        codeHash: deployment.runtimeCodeHash,
      },
      finalizedNumber: observed.blockNumber,
      finalizedHash: observed.blockHash,
      details: observed,
    },
    rpc,
    clock,
  )
  const after = await currentResource(db, id, realm, clock)
  if (after.hash !== before.hash) unavailable('resource_admission_changed')
  return after
}
