import { createConfig, custom } from 'wagmi'
import { injected } from 'wagmi/connectors'
import { base } from 'viem/chains'

export const walletConfig = createConfig({
  chains: [base],
  connectors: [injected()],
  storage: null,
  // SG-03 needs only injected account/network/signature APIs, never public RPC.
  transports: {
    [base.id]: custom({
      request: async () => {
        throw new Error('Blockchain RPC is not enabled in SG-03')
      },
    }),
  },
})
