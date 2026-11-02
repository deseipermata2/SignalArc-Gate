import {
  recoverTypedDataAddress,
  decodeFunctionData,
  encodeFunctionData,
  decodeFunctionResult,
  decodeEventLog,
  parseAbi,
  type Hex,
} from 'viem'
import { walletAddress } from '../../shared/resources'
import { hash } from '../sg03/http'
import { boundedJson, canonical, deadline, GatewayError } from '../sg05/bounds'
import { clockTime, monotonicClock, type TrustedClock } from '../sg05/clock'
import { NETWORK, USDC } from '../sg05/registry'
import type { RegistryRpc } from './registry'
export const usdcEvidenceAbi = parseAbi([
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function receiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,uint8 v,bytes32 r,bytes32 s)',
  'function transferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
  'function receiveWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce,bytes signature)',
  'function authorizationState(address authorizer,bytes32 nonce) view returns (bool)',
  'event AuthorizationUsed(address indexed authorizer,bytes32 indexed nonce)',
  'event Transfer(address indexed from,address indexed to,uint256 value)',
])
export interface SettlementExpectation {
  authorizationKey: string
  authorizationFingerprint: string
  payer: string
  recipient: string
  amount: string
  asset: string
  network: string
}
export interface SettlementEvidencePolicy {
  chainId: 8453
  asset: string
  finality: 'finalized'
  minConfirmations: number
  maxBlockAgeMs: number
  sourceId: string
}
const fail = (): never => {
  throw new GatewayError(503, 'settlement_evidence_unavailable')
}
const hexHash = (v: unknown): v is Hex =>
  typeof v === 'string' && /^0x[0-9a-fA-F]{64}$/.test(v) && !/^0x0{64}$/.test(v)
function record(v: unknown): Record<string, unknown> {
  if (!v || typeof v !== 'object' || Array.isArray(v)) return fail()
  return v as Record<string, unknown>
}
function quantity(v: unknown) {
  if (
    typeof v !== 'string' ||
    !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]{0,63})$/.test(v)
  )
    return fail()
  return BigInt(v)
}
function block(v: unknown) {
  const b = record(v)
  if (!hexHash(b.hash)) return fail()
  return {
    hash: b.hash.toLowerCase(),
    number: quantity(b.number),
    timestamp: quantity(b.timestamp),
  }
}
/** Read-only provider observation. NO persistence, production admission, signing, retries or fulfillment. */
export function createSettlementObserver(
  policy: SettlementEvidencePolicy,
  rpc: RegistryRpc,
  readClock: TrustedClock,
) {
  const p = { ...policy }
  if (
    p.chainId !== 8453 ||
    p.asset?.toLowerCase() !== USDC.toLowerCase() ||
    p.finality !== 'finalized' ||
    !Number.isSafeInteger(p.minConfirmations) ||
    p.minConfirmations < 1 ||
    p.minConfirmations > 100000 ||
    !Number.isSafeInteger(p.maxBlockAgeMs) ||
    p.maxBlockAgeMs < 1000 ||
    p.maxBlockAgeMs > 3600000 ||
    !/^[A-Za-z0-9_.:-]{1,100}$/.test(p.sourceId)
  )
    return fail()
  const clock = monotonicClock(readClock)
  return async (expected: SettlementExpectation, transaction: string) => {
    try {
      return await deadline(async (signal) => {
        const started = await clockTime(clock)
        const e = {
          ...expected,
          payer: walletAddress(expected.payer).toLowerCase(),
          recipient: walletAddress(expected.recipient).toLowerCase(),
        }
        if (
          !hexHash(transaction) ||
          e.network !== NETWORK ||
          e.asset.toLowerCase() !== USDC.toLowerCase() ||
          !/^[1-9]\d{0,11}$/.test(e.amount) ||
          !/^[0-9a-f]{64}$/.test(e.authorizationKey)
        )
          return fail()
        const call = async (
          method: Parameters<RegistryRpc>[0],
          params: unknown[],
        ) => {
          if (signal.aborted) return fail()
          const value = await rpc(method, params, signal)
          boundedJson(JSON.stringify(value), 131072, 65536)
          if (signal.aborted || (await clockTime(clock)) - started >= 5000)
            return fail()
          return value
        }
        if (quantity(await call('eth_chainId', [])) !== 8453n) return fail()
        const finalized = block(
          await call('eth_getBlockByNumber', ['finalized', false]),
        )
        const now = BigInt(await clockTime(clock)),
          timestamp = finalized.timestamp * 1000n
        if (
          timestamp > now + 1000n ||
          now - timestamp > BigInt(p.maxBlockAgeMs)
        )
          return fail()
        const receipt = record(
          await call('eth_getTransactionReceipt', [transaction]),
        )
        if (
          receipt.status !== '0x1' ||
          String(receipt.transactionHash).toLowerCase() !==
            transaction.toLowerCase() ||
          !hexHash(receipt.blockHash) ||
          typeof receipt.to !== 'string' ||
          receipt.to.toLowerCase() !== USDC.toLowerCase()
        )
          return fail()
        const number = quantity(receipt.blockNumber)
        if (
          finalized.number < number ||
          finalized.number - number + 1n < BigInt(p.minConfirmations)
        )
          return fail()
        const canonicalBlock = block(
          await call('eth_getBlockByNumber', [
            `0x${number.toString(16)}`,
            false,
          ]),
        )
        if (
          canonicalBlock.number !== number ||
          canonicalBlock.hash !== receipt.blockHash.toLowerCase() ||
          canonicalBlock.timestamp > finalized.timestamp
        )
          return fail()
        const tx = record(await call('eth_getTransactionByHash', [transaction]))
        if (
          String(tx.hash).toLowerCase() !== transaction.toLowerCase() ||
          tx.to !== receipt.to ||
          tx.from !== receipt.from ||
          quantity(tx.value) !== 0n ||
          tx.blockHash !== receipt.blockHash ||
          tx.blockNumber !== receipt.blockNumber ||
          typeof tx.input !== 'string' ||
          !/^0x[0-9a-fA-F]{8,2048}$/.test(tx.input)
        )
          return fail()
        walletAddress(tx.from)
        // Conservative direct-USDC subset. Multicall/proxy-router top-level transactions are unsupported.
        const decoded = decodeFunctionData({
          abi: usdcEvidenceAbi,
          data: tx.input as Hex,
        })
        if (
          !['transferWithAuthorization', 'receiveWithAuthorization'].includes(
            decoded.functionName,
          )
        )
          return fail()
        const a = decoded.args as readonly unknown[],
          nonce = String(a[5]).toLowerCase()
        if (
          String(a[0]).toLowerCase() !== e.payer ||
          String(a[1]).toLowerCase() !== e.recipient ||
          String(a[2]) !== e.amount ||
          !/^0x[0-9a-f]{64}$/.test(nonce) ||
          canonicalBlock.timestamp <= BigInt(String(a[3])) ||
          canonicalBlock.timestamp >= BigInt(String(a[4]))
        )
          return fail()
        const signature =
          a.length === 7
            ? String(a[6])
            : String(a[7]) +
              String(a[8]).slice(2) +
              Number(a[6]).toString(16).padStart(2, '0')
        if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) return fail()
        const recovered = await recoverTypedDataAddress({
          domain: {
            name: 'USD Coin',
            version: '2',
            chainId: 8453,
            verifyingContract: USDC,
          },
          types: {
            [decoded.functionName === 'receiveWithAuthorization'
              ? 'ReceiveWithAuthorization'
              : 'TransferWithAuthorization']: [
              { name: 'from', type: 'address' },
              { name: 'to', type: 'address' },
              { name: 'value', type: 'uint256' },
              { name: 'validAfter', type: 'uint256' },
              { name: 'validBefore', type: 'uint256' },
              { name: 'nonce', type: 'bytes32' },
            ],
          },
          primaryType:
            decoded.functionName === 'receiveWithAuthorization'
              ? 'ReceiveWithAuthorization'
              : 'TransferWithAuthorization',
          message: {
            from: a[0],
            to: a[1],
            value: a[2],
            validAfter: a[3],
            validBefore: a[4],
            nonce: a[5],
          },
          signature: signature as Hex,
        })
        if (
          recovered.toLowerCase() !== e.payer ||
          (decoded.functionName === 'receiveWithAuthorization' &&
            String(tx.from).toLowerCase() !== e.recipient)
        )
          return fail()
        const identity = await hash(
          canonical([NETWORK, USDC.toLowerCase(), e.payer, nonce]),
        )
        if (identity !== e.authorizationKey) return fail()
        const fingerprint = await hash(
          canonical({
            authorization: {
              from: e.payer,
              to: e.recipient,
              value: String(a[2]),
              validAfter: String(a[3]),
              validBefore: String(a[4]),
              nonce,
            },
            signature: signature.toLowerCase(),
          }),
        )
        if (
          !/^[0-9a-f]{64}$/.test(e.authorizationFingerprint) ||
          fingerprint !== e.authorizationFingerprint
        )
          return fail()

        if (!Array.isArray(receipt.logs) || receipt.logs.length > 64)
          return fail()
        let transfers = 0,
          used = 0
        const logIndexes = new Set<string>()
        for (const raw of receipt.logs) {
          const log = record(raw)
          if (
            log.removed !== false ||
            log.blockHash !== receipt.blockHash ||
            log.transactionHash !== receipt.transactionHash ||
            log.blockNumber !== receipt.blockNumber
          )
            return fail()
          const index = quantity(log.logIndex).toString()
          if (logIndexes.has(index)) return fail()
          logIndexes.add(index)
          if (
            typeof log.address !== 'string' ||
            log.address.toLowerCase() !== USDC.toLowerCase()
          )
            return fail()
          const event = decodeEventLog({
            abi: usdcEvidenceAbi,
            topics: log.topics as [Hex, ...Hex[]],
            data: log.data as Hex,
            strict: true,
          })
          if (event.eventName === 'Transfer') {
            if (
              event.args.from.toLowerCase() !== e.payer ||
              event.args.to.toLowerCase() !== e.recipient ||
              event.args.value.toString() !== e.amount
            )
              return fail()
            transfers++
          } else {
            if (
              event.args.authorizer.toLowerCase() !== e.payer ||
              event.args.nonce.toLowerCase() !== nonce
            )
              return fail()
            used++
          }
        }
        if (transfers !== 1 || used !== 1) return fail()
        const at = { blockHash: finalized.hash, requireCanonical: true }
        const state = await call('eth_call', [
          {
            to: USDC,
            data: encodeFunctionData({
              abi: usdcEvidenceAbi,
              functionName: 'authorizationState',
              args: [e.payer as Hex, nonce as Hex],
            }),
          },
          at,
        ])
        if (
          typeof state !== 'string' ||
          !/^0x[0-9a-fA-F]{64}$/.test(state) ||
          decodeFunctionResult({
            abi: usdcEvidenceAbi,
            functionName: 'authorizationState',
            data: state as Hex,
          }) !== true
        )
          return fail()
        for (const prior of [canonicalBlock, finalized]) {
          const current = block(
            await call('eth_getBlockByNumber', [
              `0x${prior.number.toString(16)}`,
              false,
            ]),
          )
          if (
            current.hash !== prior.hash ||
            current.number !== prior.number ||
            current.timestamp !== prior.timestamp
          )
            return fail()
        }
        return {
          evidence: 'rpc_observation_only' as const,
          productionAdmitted: false as const,
          sourceId: p.sourceId,
          transaction: transaction.toLowerCase(),
          blockNumber: number.toString(),
          blockHash: canonicalBlock.hash,
          finalizedBlockHash: finalized.hash,
          finalizedBlockNumber: finalized.number.toString(),
          authorizationKey: identity,
          authorizationFingerprint: fingerprint,
          network: NETWORK,
          asset: USDC,
          payer: e.payer,
          recipient: e.recipient,
          amount: e.amount,
        }
      }, 5000)
    } catch {
      return fail()
    }
  }
}
