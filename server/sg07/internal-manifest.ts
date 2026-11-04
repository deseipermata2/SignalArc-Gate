import { deployment } from '../registry/status'
import { canonical, GatewayError } from '../sg05/bounds'
import { NETWORK, USDC, type Snapshot } from '../sg05/registry'
import type { Attempt } from '../sg05/store'
import type { SettleResponse } from '@x402/core/types'

/** Server capability; never derived from buyer headers or merchant CRUD input. */
export interface LocalPilotAuthority {
  read(): Promise<{ manifest: unknown; revoked: number } | null>
  verifySettlement(attempt: Attempt, result: SettleResponse): Promise<void>
}
/** Deployment identity is a pin, NOT proof this fixture resource is registered. */
export function localPilotManifest(s: Snapshot) {
  return {
    provenance: 'LOCAL_SIMULATION_ONLY',
    productionAdmitted: false,
    handler: 'signalarc.resource-configuration.v1',
    manifestVersion: 1,
    chainId: 8453,
    network: NETWORK,
    asset: USDC,
    registryAddress: deployment.address,
    runtimeCodeHash: deployment.runtimeCodeHash,
    resourceId: s.id,
    merchantId: s.merchantId,
    originalOwner: s.binding.original_owner,
    owner: s.owner,
    onchainResourceId: s.binding.onchain_resource_id,
    configVersion: s.binding.registry_version,
    configHash: s.binding.config_hash,
    bindingGeneration: s.binding.generation,
    resourceRevision: s.revision,
    snapshotHash: s.hash,
    enabled: s.resource.enabled,
    amountAtomic: s.resource.priceAtomic,
    recipient: s.resource.payoutAddress,
  } as const
}
export async function assertLocalManifest(
  authority: LocalPilotAuthority,
  expected: ReturnType<typeof localPilotManifest>,
) {
  const current = await authority.read()
  if (
    !current ||
    current.revoked !== 0 ||
    canonical(current.manifest) !== canonical(expected)
  )
    throw new GatewayError(503, 'internal_pilot_admission_unavailable')
}
