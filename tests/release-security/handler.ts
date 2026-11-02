import {
  registryStatus,
  abi as deployedAbi,
  deployment,
  readDeployment,
} from '../../server/registry/status'
import { walletAddress } from '../../shared/resources'
import { localSettlementFields } from '../../server/sg05/protocol'
import { takeApiBudget } from '../../server/sg03/budget'
import { apiConfig, readJson, HttpError } from '../../server/sg03/http'
import {
  createSettlementObserver,
  usdcEvidenceAbi,
  type SettlementExpectation,
} from '../../server/sg07/settlement-evidence'
import { createReadRpc } from '../../server/sg07/rpc'
import { reviewUnknownSettlement } from '../../server/sg07/settlement-review'
import { PaymentStore } from '../../server/sg05/store'
import { hash } from '../../server/sg03/http'
import { canonical, GatewayError } from '../../server/sg05/bounds'
import {
  commitment,
  resourceId,
  NETWORK,
  USDC,
} from '../../server/sg05/registry'
import {
  keccak256,
  toHex,
  encodeFunctionData,
  encodeFunctionResult,
  encodeEventTopics,
  encodeAbiParameters,
  parseAbiParameters,
  type Hex,
} from 'viem'
globalThis.fetch = async () => {
  throw Error('Release fixture forbids native egress')
}
const now = Date.parse('2026-11-02T00:00:00Z')
const payee = '0x000000000000000000000000000000000000b0b1'
const nonce = ('0x' + '11'.repeat(32)) as Hex
const txHash = '0x' + '22'.repeat(32)
const blockHash = '0x' + '33'.repeat(32)
const finalHash = '0x' + '44'.repeat(32)
const reviewMerchantId = '10000000-0000-4000-8000-000000000001'
const reviewResourceId = '20000000-0000-4000-8000-000000000001'
const reviewAttemptId = '30000000-0000-4000-8000-000000000001'
export async function onRequest({
  request,
  env,
}: {
  request: Request
  env: Record<string, unknown> & { SIGNALARC_DB: D1Database }
}) {
  const url = new URL(request.url),
    db = env.SIGNALARC_DB
  if (
    env.APP_ENV !== 'local' ||
    env.RELEASE_LOCAL_ONLY !== 'yes' ||
    url.hostname !== '127.0.0.1' ||
    url.origin !== env.APP_ORIGIN ||
    request.method !== 'POST' ||
    request.headers.get('Origin') !== env.APP_ORIGIN ||
    request.headers.get('X-Local-Only') !== 'yes' ||
    (await db.prepare('SELECT 1').all()).meta.served_by !== 'miniflare.db'
  )
    return new Response('Unavailable', { status: 404 })
  const body = (await readJson(request)) as {
    payer: string
    signature: string
    mode: string
    action: string
    runtime?: string
    time?: number
  }
  const signer = walletAddress(body.payer)
  let calls = 0
  try {
    if (body.action === 'deployed-resource') {
      const mid = '50000000-0000-4000-8000-000000000001',
        rid = '60000000-0000-4000-8000-000000000001',
        salt = '0x' + '66'.repeat(32)
      const chainId = resourceId(signer, rid),
        configHash = commitment(
          chainId,
          'https://fixture.invalid/json',
          4096,
          salt,
        )
      await db.batch([
        db
          .prepare('INSERT OR IGNORE INTO merchants VALUES (?,?,?,?)')
          .bind(mid, payee, now, now),
        db
          .prepare(
            'INSERT OR IGNORE INTO api_resources (id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            rid,
            mid,
            'Registry fixture',
            'https://fixture.invalid/json',
            JSON.stringify({
              type: 'json',
              maxBytes: 4096,
              redirects: 'error',
            }),
            '1000',
            payee,
            NETWORK,
            1,
            now,
            now,
          ),
        db
          .prepare(
            'INSERT OR IGNORE INTO sessions (token_hash,merchant_id,origin,chain_id,created_at,expires_at) VALUES (?,?,?,?,?,?)',
          )
          .bind(
            await hash('ab'.repeat(32)),
            mid,
            url.origin,
            8453,
            Date.now(),
            Date.now() + 60000,
          ),
        db
          .prepare(
            'INSERT OR IGNORE INTO resource_registry_bindings (resource_id,original_owner,onchain_resource_id,registry_address,config_salt,config_hash,registry_version,source,checked_at) VALUES (?,?,?,?,?,?,?,?,?)',
          )
          .bind(
            rid,
            signer,
            chainId,
            deployment.address,
            salt,
            configHash,
            '1',
            'unconfirmed',
            now,
          ),
      ])
      const req = new Request(url.origin + '/api/registry?resourceId=' + rid, {
        headers: { Cookie: 'sg_session=' + 'ab'.repeat(32) },
      })
      const sampledNow = Math.floor(Date.now() / 1000)
      let reads = 0
      const response = await registryStatus(
        req,
        apiConfig(req, env),
        { REGISTRY_RPC_URL: 'https://rpc.example.com' },
        async (_input, init) => {
          const request = JSON.parse(String(init?.body))
          reads++
          if (body.mode === 'timeout') return new Promise<Response>(() => {})
          if (body.mode === 'slow-body')
            return new Response(
              new ReadableStream({
                start(c) {
                  c.enqueue(new TextEncoder().encode('{'))
                },
              }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          if (body.mode === 'rate-limit')
            return new Response('LOCAL_PROVIDER_SECRET', { status: 429 })
          if (body.mode === 'http-error')
            return new Response('LOCAL_PROVIDER_SECRET', { status: 503 })
          if (body.mode === 'unsupported' && request.method === 'eth_getCode')
            return Response.json({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32602, message: 'LOCAL_PROVIDER_SECRET' },
            })
          if (body.mode === 'rpc-error')
            return Response.json({
              jsonrpc: '2.0',
              id: request.id,
              error: { code: -32000, message: 'LOCAL_PROVIDER_SECRET' },
            })
          if (body.mode === 'malformed')
            return Response.json({
              jsonrpc: '2.0',
              id: request.id + 1,
              result: '0x2105',
            })
          let result: unknown
          if (request.method === 'eth_chainId')
            result = body.mode === 'wrong-chain' ? '0x1' : '0x2105'
          else if (request.method === 'eth_getCode') result = body.runtime
          else if (request.method === 'eth_getBlockByNumber') {
            const final =
              request.params[0] === 'finalized' || request.params[0] === '0x64'
            result = {
              number: final ? '0x64' : '0x66',
              hash:
                body.mode === 'reorg' && request.params[0] === '0x64'
                  ? finalHash
                  : final
                    ? blockHash
                    : finalHash,
              timestamp:
                '0x' +
                BigInt(
                  sampledNow -
                    (final
                      ? body.mode === 'normal-lag'
                        ? 1200
                        : body.mode === 'stale'
                          ? 3600
                          : 10
                      : body.mode === 'stale-head'
                        ? 120
                        : 2),
                ).toString(16),
            }
          } else if (String(request.params[0].data).length === 10)
            result = encodeFunctionResult({
              abi: deployedAbi,
              functionName: 'CHAIN_ID',
              result: 8453n,
            })
          else
            result = encodeFunctionResult({
              abi: deployedAbi,
              functionName: 'getResource',
              result: {
                owner:
                  body.mode === 'unregistered'
                    ? '0x0000000000000000000000000000000000000000'
                    : payee,
                version: 1n,
                enabled: true,
                payout: payee,
                priceAtomic: body.mode === 'mismatch' ? 1001n : 1000n,
                configHash,
                pendingOwner: '0x0000000000000000000000000000000000000000',
              },
            })
          if (
            body.mode === 'unregistered' &&
            request.method === 'eth_call' &&
            String(request.params[0].data).length > 10
          )
            return Response.json({
              jsonrpc: '2.0',
              id: request.id,
              error: {
                code: 3,
                data:
                  keccak256(toHex('ResourceNotFound(bytes32)')).slice(0, 10) +
                  chainId.slice(2),
              },
            })
          return Response.json({ jsonrpc: '2.0', id: request.id, result })
        },
        ['timeout', 'slow-body'].includes(body.mode) ? 30 : 5000,
      )
      return Response.json({
        status: await response.json(),
        reads,
        source: await db
          .prepare(
            'SELECT source FROM resource_registry_bindings WHERE resource_id=?',
          )
          .bind(rid)
          .first(),
      })
    }
    if (body.action === 'deployed-registry') {
      const result = await readDeployment(async (method, params) => {
        calls++
        if (method === 'eth_chainId')
          return body.mode === 'wrong-chain' ? '0x1' : '0x2105'
        if (method === 'eth_getBlockByNumber')
          return {
            number: '0x64',
            hash: '0x' + '33'.repeat(32),
            timestamp:
              '0x' +
              BigInt(
                now / 1000 -
                  (params[0] === 'latest'
                    ? 10
                    : body.mode === 'normal-lag'
                      ? 1200
                      : body.mode === 'stale'
                        ? 3600
                        : 10),
              ).toString(16),
          }
        if (method === 'eth_getCode')
          return body.mode === 'bad-code' ? '0x00' : body.runtime
        return (
          '0x' +
          BigInt(body.mode === 'bad-contract-chain' ? 1 : 8453)
            .toString(16)
            .padStart(64, '0')
        )
      }, now)
      return Response.json({ result, calls })
    }
    if (body.action === 'receipt')
      return Response.json(
        localSettlementFields({
          success: body.mode !== 'rejected',
          transaction: txHash,
          network: NETWORK,
          payer: signer,
          amount: '1000',
          extra: {
            asset: USDC,
            recipient: payee,
            internalDiagnostic: 'LOCAL_PRIVATE_DIAGNOSTIC',
            authorization: 'LOCAL_BEARER_SENTINEL',
          },
        }),
      )
    if (body.action === 'budget') {
      if (body.mode === 'fault')
        await db
          .prepare(
            "CREATE TRIGGER release_budget_fault BEFORE UPDATE ON api_request_budget BEGIN SELECT RAISE(ABORT,'local_budget_fault'); END",
          )
          .run()
      if (body.mode === 'off')
        await db.prepare('DROP TRIGGER IF EXISTS release_budget_fault').run()
      if (body.mode === 'exhaust') {
        const time = Date.now()
        await db
          .prepare(
            'UPDATE api_request_budget SET minute_start=?,minute_hits=?,day_start=?,day_hits=? WHERE id=1',
          )
          .bind(
            Math.floor(time / 60000),
            600,
            Math.floor(time / 86400000),
            20000,
          )
          .run()
        return Response.json({ exhausted: true })
      }
      if (body.mode === 'reset')
        await db.prepare('DELETE FROM api_request_budget').run()
      const one = async () => {
        try {
          await takeApiBudget(db, body.time ?? now, { minute: 2, day: 3 })
          return 200
        } catch (e) {
          return e instanceof HttpError ? e.status : 503
        }
      }
      const outcomes =
        body.mode === 'concurrent'
          ? await Promise.all(Array.from({ length: 8 }, one))
          : [await one()]
      return Response.json({
        outcomes,
        rows: (await db.prepare('SELECT * FROM api_request_budget').all())
          .results,
      })
    }
    if (body.action === 'json') {
      const value =
        body.mode === 'collection'
          ? Array.from({ length: 65 }, () => 1)
          : body.mode === 'nodes'
            ? Array.from({ length: 32 }, () => Array(32).fill(1))
            : { good: true }
      let canceled = false
      const stream = new ReadableStream<Uint8Array>({
        start(c) {
          if (body.mode !== 'slow')
            c.enqueue(new TextEncoder().encode(JSON.stringify(value)))
          if (body.mode !== 'slow') c.close()
        },
        cancel() {
          canceled = true
        },
      })
      const req = new Request('http://127.0.0.1/body', {
        method: 'POST',
        body: stream,
        headers: body.mode === 'bad-length' ? { 'Content-Length': 'wat' } : {},
      })
      try {
        const result = await readJson(req, 30)
        return Response.json({ result })
      } catch (e) {
        return Response.json(
          { error: e instanceof HttpError ? e.message : 'error', canceled },
          { status: e instanceof HttpError ? e.status : 503 },
        )
      }
    }
    if (body.action === 'rpc-clock') {
      let ticks = 0
      const rpc = createReadRpc(
        'https://rpc.example.com',
        async () => {
          calls++
          return Response.json({ jsonrpc: '2.0', id: 1, result: '0x2105' })
        },
        async () =>
          body.mode === 'hung'
            ? new Promise<number>(() => {})
            : now - ticks++ * 1000,
      )
      await rpc('eth_chainId', [], new AbortController().signal)
      return Response.json({ calls })
    }
    const authorizationFingerprint = await hash(
      canonical({
        authorization: {
          from: signer.toLowerCase(),
          to: payee,
          value: '1000',
          validAfter: String(now / 1000 - 100),
          validBefore: String(now / 1000 + 100),
          nonce,
        },
        signature: body.signature.toLowerCase(),
      }),
    )
    const e: SettlementExpectation = {
      authorizationFingerprint,
      authorizationKey: await hash(
        canonical([NETWORK, USDC.toLowerCase(), signer.toLowerCase(), nonce]),
      ),
      payer: signer,
      recipient: payee,
      amount: '1000',
      asset: USDC,
      network: NETWORK,
    }
    const policy = {
      chainId: 8453 as const,
      asset: USDC,
      finality: 'finalized' as const,
      minConfirmations: 2,
      maxBlockAgeMs: 3600000,
      sourceId: 'LOCAL_SIMULATION_ONLY',
    }
    if (body.mode === 'policy-chain') policy.chainId = 1 as 8453
    if (body.mode === 'policy-asset') policy.asset = signer
    if (body.mode === 'policy-finality')
      policy.finality = 'latest' as 'finalized'
    if (body.mode === 'policy-source') policy.sourceId = ''
    if (body.mode === 'expected-network') e.network = 'eip155:0'
    if (body.mode === 'expected-asset') e.asset = signer
    if (body.mode === 'fingerprint')
      e.authorizationFingerprint = 'ff'.repeat(32)
    if (body.mode === 'identity') e.authorizationKey = 'ab'.repeat(32)
    if (body.mode === 'payer') e.payer = payee
    if (body.mode === 'recipient') e.recipient = signer
    if (body.mode === 'amount') e.amount = '1001'
    const tx = {
      hash: txHash,
      to: USDC,
      from: payee,
      value: body.mode === 'eth-value' ? '0x1' : '0x0',
      blockHash,
      blockNumber: '0x64',
      input: encodeFunctionData({
        abi: usdcEvidenceAbi,
        functionName: body.mode.startsWith('receive')
          ? 'receiveWithAuthorization'
          : 'transferWithAuthorization',
        args: [
          signer as Hex,
          payee,
          1000n,
          BigInt(now / 1000 - 100),
          BigInt(now / 1000 + 100),
          nonce,
          (body.mode === 'invalid-signature'
            ? '0x' + '01'.repeat(65)
            : body.signature) as Hex,
        ],
      }),
    }
    const common = {
      address: USDC,
      blockHash,
      blockNumber: '0x64',
      transactionHash: txHash,
      removed: false,
    }
    const logs = [
      {
        ...common,
        logIndex: '0x0',
        topics: encodeEventTopics({
          abi: usdcEvidenceAbi,
          eventName: 'AuthorizationUsed',
          args: { authorizer: signer, nonce },
        }),
        data: '0x',
      },
      {
        ...common,
        logIndex: '0x1',
        topics: encodeEventTopics({
          abi: usdcEvidenceAbi,
          eventName: 'Transfer',
          args: { from: signer, to: payee },
        }),
        data: encodeAbiParameters(parseAbiParameters('uint256'), [1000n]),
      },
    ]
    if (body.mode === 'removed') logs[0].removed = true
    if (body.mode === 'missing-auth-log') logs.shift()
    if (body.mode === 'missing-transfer') logs.pop()
    if (body.mode === 'duplicate-log') logs.push({ ...logs[1] })
    if (body.mode === 'log-emitter') logs[0].address = signer
    if (body.mode === 'log-block') logs[0].blockHash = finalHash
    const receipt = {
      status: body.mode === 'reverted' ? '0x0' : '0x1',
      transactionHash: txHash,
      blockHash,
      blockNumber: '0x64',
      to: USDC,
      from: payee,
      logs,
    }
    if (body.mode === 'classic')
      tx.input = encodeFunctionData({
        abi: usdcEvidenceAbi,
        functionName: 'transferWithAuthorization',
        args: [
          signer,
          payee,
          1000n,
          BigInt(now / 1000 - 100),
          BigInt(now / 1000 + 100),
          nonce,
          Number(BigInt('0x' + body.signature.slice(130))),
          body.signature.slice(0, 66) as Hex,
          ('0x' + body.signature.slice(66, 130)) as Hex,
        ],
      })
    if (body.mode === 'router') {
      tx.to = signer
      receipt.to = signer
    }
    if (body.mode === 'calldata') tx.input = '0x12345678'
    if (body.mode === 'tx-hash') tx.hash = finalHash
    if (body.mode === 'receipt-hash') receipt.transactionHash = finalHash
    if (body.mode === 'tx-block') tx.blockHash = finalHash
    let numbered = 0
    const observe = createSettlementObserver(
      policy,
      async (method, params) => {
        calls++
        if (body.mode === 'rpc-error') throw Error('LOCAL_PRIVATE_DIAGNOSTIC')
        if (body.mode === 'rpc-hung') return new Promise(() => {})
        if (method === 'eth_chainId')
          return body.mode === 'chain' ? '0x1' : '0x2105'
        if (method === 'eth_getBlockByNumber') {
          const isFinal = params[0] === 'finalized' || params[0] === '0x66'
          if (!isFinal) numbered++
          return {
            number: isFinal
              ? body.mode === 'unfinalized'
                ? '0x64'
                : '0x66'
              : '0x64',
            hash: isFinal
              ? finalHash
              : body.mode === 'reorg' && numbered > 1
                ? finalHash
                : blockHash,
            timestamp:
              '0x' +
              BigInt(
                now / 1000 -
                  (isFinal ? 10 : 20) -
                  (body.mode === 'stale' ? 4000 : 0),
              ).toString(16),
          }
        }
        if (method === 'eth_getTransactionReceipt')
          return body.mode === 'missing' ? null : receipt
        if (method === 'eth_getTransactionByHash') return tx
        if (method === 'eth_call')
          return encodeFunctionResult({
            abi: usdcEvidenceAbi,
            functionName: 'authorizationState',
            result: body.mode !== 'nonce-unused',
          })
        throw Error('Unexpected mock read method')
      },
      async () => (body.mode === 'clock-malformed' ? NaN : now),
    )
    if (body.action === 'settlement-review') {
      await db
        .prepare(
          'INSERT OR IGNORE INTO merchants (id,wallet_address,created_at,updated_at) VALUES (?,?,?,?)',
        )
        .bind(reviewMerchantId, signer.toLowerCase(), now, now)
        .run()
      await db
        .prepare(
          'INSERT OR IGNORE INTO api_resources (id,merchant_id,name,upstream_url,response_config,price_atomic,payout_address,network,enabled,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)',
        )
        .bind(
          reviewResourceId,
          reviewMerchantId,
          'Local settlement evidence fixture',
          'https://fixture.invalid/json',
          JSON.stringify({ type: 'json', maxBytes: 4096, redirects: 'error' }),
          '1000',
          payee,
          NETWORK,
          1,
          now,
          now,
        )
        .run()
      await db
        .prepare(
          `INSERT OR IGNORE INTO payment_attempts (
            id,merchant_id,resource_id,idempotency_key,network,amount_atomic,status,
            created_at,updated_at,phase,authorization_key,authorization_fingerprint,
            buyer_address,asset,recipient,request_hash,url_hash,requirements_json,
            snapshot_hash,config_revision,binding_generation,config_version,config_hash,
            expires_at,operation_deadline,evidence_kind
          ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
        )
        .bind(
          reviewAttemptId,
          reviewMerchantId,
          reviewResourceId,
          'local-settlement-review',
          NETWORK,
          '1000',
          'pending',
          now,
          now,
          'created',
          e.authorizationKey,
          e.authorizationFingerprint,
          signer.toLowerCase(),
          USDC,
          payee,
          'a'.repeat(64),
          'b'.repeat(64),
          '{}',
          'c'.repeat(64),
          1,
          1,
          '1',
          'd'.repeat(64),
          now + 60000,
          now + 10000,
          'local_simulation',
        )
        .run()
      const phase = await db
        .prepare('SELECT phase FROM payment_attempts WHERE id=?')
        .bind(reviewAttemptId)
        .first<{ phase: string }>()
      if (phase?.phase === 'created')
        await db.batch([
          db
            .prepare("UPDATE payment_attempts SET phase='verifying' WHERE id=?")
            .bind(reviewAttemptId),
          db
            .prepare("UPDATE payment_attempts SET phase='verified' WHERE id=?")
            .bind(reviewAttemptId),
          db
            .prepare(
              "UPDATE payment_attempts SET phase='settlement_pending' WHERE id=?",
            )
            .bind(reviewAttemptId),
          db
            .prepare(
              "UPDATE payment_attempts SET phase='settlement_unknown' WHERE id=?",
            )
            .bind(reviewAttemptId),
        ])
      const candidate =
        body.mode === 'second-transaction' ? '0x' + '55'.repeat(32) : txHash
      const reviewer =
        body.mode === 'forged-authority'
          ? async (expected: SettlementExpectation, transaction: string) => ({
              ...(await observe(expected, transaction)),
              productionAdmitted: true,
            })
          : body.mode === 'wrong-amount-observation'
            ? async (expected: SettlementExpectation, transaction: string) => ({
                ...(await observe(expected, transaction)),
                amount: '1001',
              })
            : body.mode === 'second-transaction'
              ? async (
                  expected: SettlementExpectation,
                  transaction: string,
                ) => ({
                  ...(await observe(expected, txHash)),
                  transaction,
                })
              : observe
      if (
        body.mode === 'forged-authority' ||
        body.mode === 'wrong-amount-observation'
      ) {
        try {
          await reviewUnknownSettlement(
            new PaymentStore(db, async () => now),
            reviewMerchantId,
            reviewAttemptId,
            txHash,
            reviewer,
            async () => now,
          )
        } catch (error) {
          return Response.json(
            {
              error: error instanceof GatewayError ? error.code : 'unavailable',
              rows: await db
                .prepare(
                  'SELECT count(*) AS n FROM settlement_evidence_observations WHERE attempt_id=?',
                )
                .bind(reviewAttemptId)
                .first(),
            },
            { status: 503 },
          )
        }
      }
      if (body.mode === 'tamper') {
        let updateBlocked = false,
          deleteBlocked = false
        try {
          await db
            .prepare(
              "UPDATE settlement_evidence_observations SET outcome='conflict' WHERE attempt_id=?",
            )
            .bind(reviewAttemptId)
            .run()
        } catch {
          updateBlocked = true
        }
        try {
          await db
            .prepare(
              'DELETE FROM settlement_evidence_observations WHERE attempt_id=?',
            )
            .bind(reviewAttemptId)
            .run()
        } catch {
          deleteBlocked = true
        }
        return Response.json({
          updateBlocked,
          deleteBlocked,
          count: await db
            .prepare(
              'SELECT count(*) AS n FROM settlement_evidence_observations WHERE attempt_id=?',
            )
            .bind(reviewAttemptId)
            .first(),
        })
      }
      const reviewed = await reviewUnknownSettlement(
        new PaymentStore(db, async () => now),
        body.mode === 'wrong-merchant'
          ? '40000000-0000-4000-8000-000000000001'
          : reviewMerchantId,
        reviewAttemptId,
        candidate,
        reviewer,
        async () => now,
      )
      return Response.json({
        review: reviewed,
        attempt: await db
          .prepare(
            'SELECT phase,evidence_kind FROM payment_attempts WHERE id=?',
          )
          .bind(reviewAttemptId)
          .first(),
        receipts: await db
          .prepare(
            'SELECT count(*) AS n FROM payment_receipts WHERE attempt_id=?',
          )
          .bind(reviewAttemptId)
          .first(),
        rows: await db
          .prepare(
            'SELECT outcome,transaction_hash,provenance,evidence_json FROM settlement_evidence_observations WHERE attempt_id=? ORDER BY rowid',
          )
          .bind(reviewAttemptId)
          .all(),
      })
    }
    const result = await observe(
      e,
      body.mode === 'zero-hash' ? '0x' + '00'.repeat(32) : txHash,
    )
    return Response.json({
      localSimulationOnly: true,
      result,
      calls,
      receipts: await db
        .prepare('SELECT count(*) AS n FROM payment_receipts')
        .first(),
    })
  } catch (e) {
    return Response.json(
      { error: e instanceof GatewayError ? e.code : 'unavailable', calls },
      { status: 503 },
    )
  }
}
