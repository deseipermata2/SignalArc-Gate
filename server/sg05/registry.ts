import {
  encodeAbiParameters,
  keccak256,
  toHex,
  type Address,
  type Hex,
} from 'viem'
import { resourceInput, type ResourceInput } from '../../shared/resources'
import { hash } from '../sg03/http'
import { canonical, GatewayError } from './bounds'
import { clockTime, type TrustedClock } from './clock'
export const NETWORK = 'eip155:8453' as const
export const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
export interface Binding {
  original_owner: string
  onchain_resource_id: string
  registry_address: string | null
  config_salt: string
  config_hash: string
  registry_version: string
  source: string
  checked_at: number
  generation: number
}
export interface RegistryState {
  id: string
  owner: string
  pendingOwner: string | null
  payout: string
  priceAtomic: string
  configHash: string
  version: string
  enabled: boolean
  observedAt: number
  localSimulationOnly: true
}
export interface Snapshot {
  id: string
  merchantId: string
  owner: string
  revision: number
  binding: Binding
  resource: ResourceInput
  hash: string
}
export type RegistryReader = (id: string) => Promise<RegistryState>
export function resourceId(owner: string, uuid: string): Hex {
  if (
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(uuid)
  )
    throw new GatewayError(503, 'invalid_resource_binding')
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'uint256' },
        { type: 'address' },
        { type: 'bytes16' },
      ],
      [
        keccak256(toHex('SignalArcGate.Resource.v1')),
        8453n,
        owner as Address,
        `0x${uuid.replaceAll('-', '')}` as Hex,
      ],
    ),
  )
}
export function commitment(
  id: string,
  url: string,
  maxBytes: number,
  salt: string,
): Hex {
  if (!/^0x[0-9a-fA-F]{64}$/.test(salt))
    throw new GatewayError(503, 'invalid_resource_binding')
  return keccak256(
    encodeAbiParameters(
      [
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'bytes32' },
        { type: 'uint8' },
        { type: 'uint32' },
        { type: 'uint8' },
        { type: 'bytes32' },
      ],
      [
        keccak256(toHex('SignalArcGate.EndpointConfig.v1')),
        id as Hex,
        keccak256(toHex(url)),
        1,
        maxBytes,
        0,
        salt as Hex,
      ],
    ),
  )
}
/** Only the isolated local profile can accept a simulated observation. No public sync adapter exists. */
export async function snapshot(
  db: D1Database,
  id: string,
  read: RegistryReader,
  clock: TrustedClock,
): Promise<Snapshot> {
  const row = await db
    .prepare(
      'SELECT r.*, m.wallet_address AS owner FROM api_resources r JOIN merchants m ON m.id = r.merchant_id WHERE r.id = ?',
    )
    .bind(id)
    .first<Record<string, unknown>>()
  if (!row) throw new GatewayError(404, 'resource_not_found')
  const now = await clockTime(clock)
  const binding = await db
    .prepare('SELECT * FROM resource_registry_bindings WHERE resource_id = ?')
    .bind(id)
    .first<Binding>()
  if (
    !binding ||
    binding.source !== 'local_simulation' ||
    binding.registry_address !== null
  )
    throw new GatewayError(503, 'registry_unconfirmed')
  if (now - binding.checked_at > 300_000)
    throw new GatewayError(503, 'registry_stale')
  if (binding.checked_at > now + 1000)
    throw new GatewayError(503, 'registry_clock_invalid')
  const resource = resourceInput({
    name: row.name,
    upstreamUrl: row.upstream_url,
    responseConfig: JSON.parse(String(row.response_config)),
    priceAtomic: row.price_atomic,
    payoutAddress: row.payout_address,
    network: row.network,
    enabled: row.enabled === 1,
  })
  const owner = String(row.owner).toLowerCase()
  const derived = resourceId(binding.original_owner, id)
  const computed = commitment(
    derived,
    resource.upstreamUrl,
    resource.responseConfig.maxBytes,
    binding.config_salt,
  )
  const state = await read(derived)
  if (
    !resource.enabled ||
    state.localSimulationOnly !== true ||
    !state.enabled ||
    state.pendingOwner ||
    state.id !== derived ||
    state.owner.toLowerCase() !== owner ||
    state.payout.toLowerCase() !== resource.payoutAddress.toLowerCase() ||
    state.priceAtomic !== resource.priceAtomic ||
    state.version !== binding.registry_version ||
    !/^[1-9]\d{0,19}$/.test(state.version) ||
    BigInt(state.version) > 2n ** 64n - 1n ||
    state.configHash !== computed ||
    binding.config_hash !== computed ||
    binding.onchain_resource_id !== derived ||
    now - state.observedAt > 30_000 ||
    state.observedAt > now + 1000
  )
    throw new GatewayError(409, 'resource_registry_mismatch')
  const data = {
    id,
    merchantId: String(row.merchant_id),
    owner,
    revision: Number(row.payment_revision),
    binding,
    resource,
  }
  return {
    ...data,
    hash: await hash(
      canonical({ ...data, binding: { ...binding, checked_at: undefined } }),
    ),
  }
}
