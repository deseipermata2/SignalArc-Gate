import { NETWORK, USDC } from '../sg05/registry'
/** Fixed owner-controlled JSON. No URL, DNS, fetch, buyer headers or arbitrary handler dispatch. */
export function internalDocument(input: {
  resourceId: string
  amountAtomic: string
  payTo: string
  registryVersion: string
  configurationCommitment: string
}) {
  return {
    document: 'SignalArc Gate resource payment configuration',
    resourceId: input.resourceId,
    network: NETWORK,
    asset: USDC,
    amountAtomic: input.amountAtomic,
    payTo: input.payTo,
    registryVersion: input.registryVersion,
    configurationCommitment: input.configurationCommitment,
  }
}
