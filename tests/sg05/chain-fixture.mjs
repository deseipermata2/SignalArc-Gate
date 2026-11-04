import { BuilderCodeFacilitatorExtension } from '@x402/extensions/builder-code'
import {
  encodeAbiParameters,
  encodeEventTopics,
  encodeFunctionData,
  encodeFunctionResult,
  keccak256,
  parseAbi,
  toHex,
} from 'viem'
const abi = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
  'function authorizationState(address authorizer,bytes32 nonce) view returns (bool)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
// Entirely synthetic chain history. No RPC client, wallet, signing or broadcast capability.
export function chainFixture(payload, settlement, asset, now) {
  const a = payload.payload.authorization
  const blockHash = keccak256(toHex('LOCAL SIMULATION ONLY block 100'))
  const finalHash = keccak256(toHex('LOCAL SIMULATION ONLY block 102'))
  const common = {
    address: asset,
    blockHash,
    blockNumber: '0x64',
    transactionHash: settlement.transaction,
    removed: false,
  }
  const fixture = {
    localSimulationOnly: true,
    chainId: '0x2105',
    canonical: {
      hash: blockHash,
      number: '0x64',
      timestamp: '0x' + BigInt(Math.floor(now / 1000) - 2).toString(16),
    },
    finalized: {
      hash: finalHash,
      number: '0x66',
      timestamp: '0x' + BigInt(Math.floor(now / 1000) - 1).toString(16),
    },
    tx: {
      hash: settlement.transaction,
      to: asset,
      from: a.to,
      value: '0x0',
      blockHash,
      blockNumber: '0x64',
      input: encodeFunctionData({
        abi,
        functionName: 'transferWithAuthorization',
        args: [
          a.from,
          a.to,
          BigInt(a.value),
          BigInt(a.validAfter),
          BigInt(a.validBefore),
          a.nonce,
          payload.payload.signature,
        ],
      }),
    },
    receipt: {
      status: '0x1',
      transactionHash: settlement.transaction,
      to: asset,
      from: a.to,
      blockHash,
      blockNumber: '0x64',
      logs: [
        {
          ...common,
          logIndex: '0x0',
          topics: encodeEventTopics({
            abi,
            eventName: 'AuthorizationUsed',
            args: { authorizer: a.from, nonce: a.nonce },
          }),
          data: '0x',
        },
        {
          ...common,
          logIndex: '0x1',
          topics: encodeEventTopics({
            abi,
            eventName: 'Transfer',
            args: { from: a.from, to: a.to },
          }),
          data: encodeAbiParameters([{ type: 'uint256' }], [BigInt(a.value)]),
        },
      ],
    },
    state: encodeFunctionResult({
      abi,
      functionName: 'authorizationState',
      result: true,
    }),
  }
  const suffix = new BuilderCodeFacilitatorExtension().buildDataSuffix({
    paymentPayload: payload,
    paymentRequirements: payload.accepted,
  })
  if (suffix) fixture.tx.input += suffix.slice(2)
  return fixture
}
export function alterChainFixture(original, mode, other) {
  const f = structuredClone(original)
  if (!f) return null
  if (mode === 'missing') return null
  if (mode === 'provenance') f.localSimulationOnly = false
  if (mode === 'chain') f.chainId = '0x1'
  if (mode === 'reverted') f.receipt.status = '0x0'
  if (mode === 'canonical') f.canonical.hash = f.finalized.hash
  if (mode === 'unfinalized') f.finalized.number = '0x63'
  if (mode === 'stale') f.finalized.timestamp = '0x1'
  if (mode === 'token') f.receipt.to = other
  if (mode === 'payer')
    f.receipt.logs[1].topics[1] =
      '0x' + '00'.repeat(12) + other.slice(2).toLowerCase()
  if (mode === 'payee')
    f.receipt.logs[1].topics[2] =
      '0x' + '00'.repeat(12) + other.slice(2).toLowerCase()
  if (mode === 'amount') f.receipt.logs[1].data = '0x' + '01'.padStart(64, '0')
  if (mode === 'authorization')
    f.receipt.logs[0].topics[2] = '0x' + 'ff'.repeat(32)
  if (mode === 'unused') f.state = '0x' + '00'.repeat(32)
  if (mode === 'removed') f.receipt.logs[0].removed = true
  if (mode === 'duplicate') f.receipt.logs.push({ ...f.receipt.logs[1] })
  return f
}
