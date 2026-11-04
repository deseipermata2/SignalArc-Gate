import { generateKeyPairSync } from 'node:crypto'
import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { readFile, writeFile, mkdtemp, rm } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { resolve, join } from 'node:path'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { keccak256, toHex } from 'viem'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { localRuntime } from '../../scripts/local-runtime.mjs'
import { chainFixture } from '../sg05/chain-fixture.mjs'
const root = resolve(import.meta.dirname, '../..'),
  asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
const buyer = privateKeyToAccount(generatePrivateKey()) // Unfunded ephemeral LOCAL cryptographic fixture; never printed or persisted.
const artifact = JSON.parse(
  await readFile(
    join(root, 'contracts/out/EndpointRegistry.sol/EndpointRegistry.json'),
    'utf8',
  ),
)
const epoch = Date.now(),
  tick = performance.now()
const localNow = () => Math.floor(epoch + performance.now() - tick)
let mode = '',
  chain,
  verifyCalls = 0,
  settleCalls = 0,
  hook,
  count = 0
const mock = createServer(async (req, res) => {
  try {
    let raw = ''
    for await (const c of req) raw += c
    const b = JSON.parse(raw || '{}')
    let result = {}
    if (req.url === '/state')
      result = {
        now: localNow(),
        headTimestamp:
          chain?.finalized.timestamp ??
          '0x' + BigInt(Math.floor(epoch / 1000) - 1).toString(16),
        code: artifact.deployedBytecode.object,
        chain: chain ?? {
          finalized: {
            number: '0x66',
            hash: keccak256(toHex('LOCAL SIMULATION ONLY block 102')),
            timestamp: '0x' + BigInt(Math.floor(epoch / 1000) - 1).toString(16),
          },
        },
        mode,
      }
    if (req.url === '/verify') {
      verifyCalls++
      if (hook) await hook('verify')
      result =
        mode === 'verify-reject'
          ? { isValid: false, invalidReason: 'LOCAL rejection' }
          : {
              isValid: true,
              payer: b.p.payload.authorization.from.toLowerCase(),
            }
    }
    if (req.url === '/settle') {
      settleCalls++
      if (hook) await hook('settle')
      const a = b.p.payload.authorization
      const settlement = {
        success: true,
        transaction: keccak256(toHex('LOCAL SIMULATION ONLY ' + a.nonce)),
        network: 'eip155:8453',
        payer: a.from.toLowerCase(),
        amount: a.value,
      }
      chain = chainFixture(b.p, settlement, asset, localNow())
      result = mode === 'ambiguous' ? { success: true } : settlement
    }
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ...result, now: localNow() }))
  } catch {
    res.writeHead(503)
    res.end('{}')
  }
})
await new Promise((r) => mock.listen(0, '127.0.0.1', r))
const runtime = await localRuntime({
  includeApp: true,
  fixture: {
    prefix: 'activation',
    module: join(root, 'tests/activation/handler.ts'),
    bindings: {
      ACTIVATION_LOCAL_ONLY: 'yes',
      MOCK_ORIGIN: `http://127.0.0.1:${mock.address().port}`,
    },
  },
})
const pass = (s) => {
  count++
  console.log('PASS ' + s)
}
async function control(action, id, mode, testJwtKey) {
  const r = await fetch(runtime.origin + '/activation/control', {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'X-Local-Only': 'yes',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, id, mode, testJwtKey }),
  })
  assert.equal(r.status, 200, await r.clone().text())
  return r.json()
}
const seed = async () => (await control('seed')).id
const inspect = (id) => control('inspect', id)
async function challenge(id) {
  const r = await fetch(runtime.origin + '/activation/pay/' + id)
  assert.equal(r.status, 402, await r.clone().text())
  return r.json()
}
async function signed(c, patch = {}) {
  const a = {
    from: buyer.address,
    to: c.accepts[0].payTo,
    value: c.accepts[0].amount,
    validAfter: String(Math.floor(localNow() / 1000) - 10),
    validBefore: String(Math.floor(localNow() / 1000) + 55),
    nonce: keccak256(toHex(crypto.randomUUID())),
    ...patch,
  }
  const signature = await buyer.signTypedData({
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: asset,
    },
    primaryType: 'TransferWithAuthorization',
    types: {
      TransferWithAuthorization: [
        { name: 'from', type: 'address' },
        { name: 'to', type: 'address' },
        { name: 'value', type: 'uint256' },
        { name: 'validAfter', type: 'uint256' },
        { name: 'validBefore', type: 'uint256' },
        { name: 'nonce', type: 'bytes32' },
      ],
    },
    message: {
      ...a,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
    },
  })
  return {
    x402Version: 2,
    resource: c.resource,
    accepted: c.accepts[0],
    extensions: c.extensions,
    payload: { authorization: a, signature },
  }
}
async function submit(p, extra = '', finish = true) {
  const u = new URL(p.resource.url)
  u.pathname = u.pathname.replace('/api/pay/', '/activation/pay/')
  u.search += extra
  const result = await fetch(u, {
    headers: { 'PAYMENT-SIGNATURE': encodePaymentSignatureHeader(p) },
  })
  if (
    finish &&
    result.status === 202 &&
    (await result.clone().json()).paymentStatus === 'settled_delivery_pending'
  )
    return submit(p, extra, false)
  return result
}
async function setup() {
  mode = ''
  hook = undefined
  return seed()
}
try {
  assert.equal(artifact.deployedBytecode.object.startsWith('0x'), true)
  const jwtPair = generateKeyPairSync('ed25519'),
    jwtFixture = Buffer.concat([
      jwtPair.privateKey.export({ format: 'der', type: 'pkcs8' }).subarray(-32),
      jwtPair.publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
    ]).toString('base64')
  const jwt = await control('jwt', '', '', jwtFixture)
  assert.equal(
    jwt.verified,
    true,
    'public CDP JWT helper must execute and verify in workerd using an ephemeral LOCAL key',
  )
  assert.equal(jwt.algorithm, 'EdDSA')
  assert.equal(jwt.ttl, 60)
  assert.deepEqual(jwt.audience, [
    'POST api.cdp.coinbase.com/platform/v2/x402/settle',
  ])
  pass(
    'actual public CDP JWT helper signs verifiable short-lived request-bound LOCAL JWT in workerd, no account or network',
  )
  const migrations = await runtime.control('migrate')
  assert.equal(migrations.applied.at(-1), '0009_sg07_payment_activation.sql')
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  pass(
    'nine forward migrations apply atomically and repeat without checksum changes',
  )
  const ledger = await control('ledger', 'LOCAL_SIMULATION_ONLY')
  assert.deepEqual(
    ledger.entries.map((e) => e.finalized_number),
    ['100', '101'],
  )
  pass(
    'native D1 evidence watermark permits normal finalized-anchor advancement with identical immutable identity',
  )
  assert.equal(ledger.conflict, true)
  assert.equal(ledger.replay, true)
  assert.equal(ledger.permanent, true)
  assert.equal(ledger.quarantine.reason, 'conflicting_canonical_evidence')
  pass(
    'canonical conflict is durably quarantined; earlier proof replay or deletion cannot clear it',
  )
  const enabled = await control(
    'enabledRoute',
    '00000000-0000-4000-8000-000000000001',
  )
  assert.equal(enabled.status, 503)
  assert.equal(enabled.result.error, 'payment_realm_unavailable')
  assert.equal(enabled.blocked, 0)
  pass(
    'fully configured production route refuses local D1 simulation without any external request',
  )
  const missing = await control(
    'missingMigration',
    '00000000-0000-4000-8000-000000000001',
  )
  assert.equal(missing.status, 503)
  assert.equal(
    missing.result.error,
    'payment_configuration_or_migrations_unavailable',
  )
  assert.equal(missing.blocked, 0)
  pass(
    'missing activation migration fails closed before credential use or transport',
  )
  for (const mode of ['redirect', 'http', 'malformed']) {
    const t = await control('transport', '', mode)
    assert.equal(t.rejected, true)
    assert.equal(t.calls, 1)
    assert.equal(t.manual, true)
    assert.equal(t.audience, 'api.cdp.coinbase.com/platform/v2/x402/supported')
    assert.equal(t.cache, 'no-store')
    pass(
      'official CDP transport ' +
        mode +
        ' fails closed without redirect or retry',
    )
  }
  for (const mode of ['emergency', 'credentials']) {
    assert.equal((await control('config', '', mode)).refused, true)
    pass('production ' + mode + ' gate fails closed')
  }
  let id = await setup(),
    c = await challenge(id),
    p = await signed(c)
  assert.equal(c.accepts[0].network, 'eip155:8453')
  assert.equal(c.accepts[0].asset, asset)
  assert.ok(c.extensions['builder-code'])
  pass(
    '402 binds issued ticket, native Base USDC and official Builder Code declaration',
  )
  const snapshot = await inspect(id),
    toolDirectory = await mkdtemp(join(root, '.wrangler/activation-tool-'))
  try {
    const input = join(toolDirectory, 'snapshot.json')
    await writeFile(
      input,
      JSON.stringify({
        resource: snapshot.resource,
        binding: snapshot.binding,
        merchant: snapshot.merchant,
        expiresAt: new Date(localNow() + 86400000).toISOString(),
      }),
    )
    const sql = execFileSync(
      process.execPath,
      [join(root, 'scripts/prepare-payment-manifest.mjs'), input],
      { encoding: 'utf8' },
    )
    assert.ok(sql.includes('NOT EXECUTED'))
    assert.ok(sql.includes("'operator_rpc'"))
    assert.ok(sql.includes(snapshot.binding.config_hash))
    assert.ok(!sql.includes(snapshot.resource.upstream_url))
    assert.equal((await inspect(id)).manifest.realm, 'local_simulation')
    pass(
      'owner manifest preparation emits review-only exact configuration SQL, exposes no upstream URL, executes no production admission',
    )
  } finally {
    await rm(toolDirectory, { recursive: true, force: true })
  }
  let r = await submit(p)
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal((await r.json()).localSimulationOnly, true)
  assert.ok(r.headers.get('PAYMENT-RESPONSE'))
  let saved = await inspect(id)
  assert.equal(saved.attempts[0].phase, 'fulfilled')
  assert.equal(saved.receipts.length, 1)
  assert.equal(saved.receipts[0].evidence_kind, 'local_simulation')
  assert.deepEqual(saved.analytics, [
    { event_type: 'payment_settled', evidence_kind: 'local_simulation' },
  ])
  assert.equal(saved.blocked, 0)
  pass(
    'real workerd/D1: signed LOCAL authorization -> verify -> settle -> canonical token proof -> durable LOCAL receipt -> JSON',
  )
  let calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 409)
  assert.equal(settleCalls, calls)
  assert.equal((await inspect(id)).receipts.length, 1)
  pass(
    'fulfilled authorization replay neither delivers twice nor settles again',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  const results = await Promise.all([submit(p), submit(p)])
  assert.equal(
    results.filter((x) => x.status === 200).length,
    1,
    JSON.stringify(
      await Promise.all(
        results.map(async (r) => ({
          status: r.status,
          body: await r.clone().json(),
        })),
      ),
    ),
  )
  assert.equal(settleCalls, calls + 1)
  pass(
    'concurrent workers durably initiate only one settlement and one delivery',
  )
  for (const variant of [
    'chain',
    'asset',
    'price',
    'recipient',
    'signature',
    'expired',
  ]) {
    id = await setup()
    c = await challenge(id)
    p = await signed(
      c,
      variant === 'expired'
        ? { validBefore: String(Math.floor(localNow() / 1000) - 1) }
        : {},
    )
    if (variant === 'chain') p.accepted.network = 'eip155:1'
    if (variant === 'asset')
      p.accepted.asset = '0x0000000000000000000000000000000000000001'
    if (variant === 'price') p.accepted.amount = '1001'
    if (variant === 'recipient')
      p.payload.authorization.to = '0x0000000000000000000000000000000000000001'
    if (variant === 'signature') p.payload.signature = '0x' + '11'.repeat(65)
    calls = settleCalls
    r = await submit(p)
    assert.notEqual(r.status, 200)
    assert.equal(settleCalls, calls)
    assert.equal((await inspect(id)).receipts.length, 0)
    pass(variant + ' rejected before settlement without receipt')
  }
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  mode = 'verify-reject'
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 402)
  assert.equal(settleCalls, calls)
  assert.equal((await inspect(id)).attempts[0].phase, 'rejected')
  pass('facilitator verification rejection cannot authorize settlement')
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  mode = 'expires-on-verify'
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 409)
  assert.equal(settleCalls, calls)
  assert.equal((await inspect(id)).attempts[0].phase, 'failed')
  pass(
    'expired durable verification lease cannot be revived by a late facilitator reply',
  )
  for (const m of [
    'wrong-chain',
    'wrong-price',
    'disabled',
    'rpc-error',
    'not-final',
  ]) {
    id = await setup()
    mode = m
    calls = settleCalls
    r = await fetch(runtime.origin + '/activation/pay/' + id)
    assert.equal(r.status, 503)
    assert.equal(settleCalls, calls)
    assert.equal((await inspect(id)).attempts.length, 0)
    pass(m + ' registry evidence fails closed before payable challenge')
  }
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  await control('revoke', id)
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 503)
  assert.equal(settleCalls, calls)
  pass('permanent operator revocation blocks payment preparation')
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  await control('edit', id)
  r = await submit(p)
  assert.equal(r.status, 503)
  assert.ok((await inspect(id)).manifest.revoked_at)
  pass('merchant edits permanently revoke obsolete manifest and authorization')
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  mode = 'ambiguous'
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 202)
  saved = await inspect(id)
  assert.equal(saved.attempts[0].phase, 'settlement_unknown')
  assert.equal(saved.receipts.length, 0)
  r = await submit(p)
  assert.equal(r.status, 202)
  assert.equal(settleCalls, calls + 1)
  pass(
    'ambiguous SDK response stays unknown across fresh gateway instances without resubmission',
  )
  r = await submit(p, '&transaction=' + chain.tx.hash)
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal(settleCalls, calls + 1)
  assert.equal((await inspect(id)).receipts.length, 1)
  pass(
    'untrusted transaction hint can only trigger independent exact onchain verification, never another charge',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  await control('failure')
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 202)
  saved = await inspect(id)
  assert.equal(saved.receipts.length, 0)
  assert.equal(saved.attempts[0].phase, 'settlement_pending')
  assert.equal(saved.analytics.length, 0)
  assert.equal((await control('permitReplay', id)).permitted, false)
  pass(
    'durable submission permit cannot be reacquired after receipt persistence failure',
  )
  await control('repair')
  r = await submit(p)
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal(settleCalls, calls + 1)
  assert.equal((await inspect(id)).receipts.length, 1)
  pass(
    'D1 receipt failure rolls back settlement atomically; durable report recovers without second settlement',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  calls = settleCalls
  r = await submit(p, '', false)
  assert.equal(r.status, 202)
  assert.equal((await r.json()).paymentStatus, 'settled_delivery_pending')
  const race = await control('deliveryRace', id)
  assert.equal(race.claimed, true)
  assert.equal(race.reclaimed, true)
  assert.equal(race.staleFinish, false)
  assert.equal(race.staleFailure, false)
  assert.equal(race.finished, true)
  assert.equal(race.attempt.phase, 'fulfilled')
  assert.equal(race.attempt.delivery_claims, 2)
  assert.equal(settleCalls, calls + 1)
  assert.equal((await inspect(id)).receipts.length, 1)
  pass(
    'stale delivery worker cannot finalize or fail a newer durable delivery generation',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  mode = 'delivery-error'
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 503)
  saved = await inspect(id)
  assert.equal(saved.receipts.length, 1)
  assert.equal(saved.attempts[0].phase, 'fulfillment_failed')
  mode = ''
  r = await submit(p)
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal(settleCalls, calls + 1)
  assert.equal((await inspect(id)).receipts.length, 1)
  pass(
    'known delivery failure retries fixed JSON against canonical evidence without another charge',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  mode = 'revoke-on-settle'
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 503, await r.clone().text())
  saved = await inspect(id)
  assert.equal(saved.receipts.length, 1)
  assert.equal(saved.attempts[0].phase, 'fulfillment_failed')
  hook = undefined
  r = await submit(p)
  assert.equal(r.status, 503)
  assert.equal(settleCalls, calls + 1)
  pass(
    'revocation during settlement preserves receipt and paid-but-unfulfilled state without delivery or recharging',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  hook = async (step) => {
    if (step === 'settle') mode = 'not-final'
  }
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 202)
  await control('expire', id)
  hook = undefined
  mode = ''
  r = await submit(p)
  assert.equal(r.status, 200, await r.clone().text())
  assert.equal(settleCalls, calls + 1)
  pass(
    'restart after pending settlement reconciles persisted transaction only once finalized',
  )
  id = await setup()
  c = await challenge(id)
  p = await signed(c)
  hook = async (step) => {
    if (step === 'settle') mode = 'reorg'
  }
  calls = settleCalls
  r = await submit(p)
  assert.equal(r.status, 202)
  assert.equal((await inspect(id)).receipts.length, 0)
  assert.equal(settleCalls, calls + 1)
  pass(
    'conflicting canonical block hash prevents receipt and protected response',
  )
  for (const path of [
    '/api/pay/' + id,
    '/api/pay/' + id + '?localSimulation=true',
    '/activation/pay/' + id,
  ]) {
    r = await fetch(runtime.origin + path, {
      headers: { 'X-Local-Only': 'yes', X402_PAYMENTS_ENABLED: 'true' },
    })
    if (path.startsWith('/api/')) assert.equal(r.status, 404)
  }
  pass(
    'public route remains disabled; forged local and activation headers cannot select test authority',
  )
  r = await fetch(runtime.origin + '/api/health')
  assert.equal(r.status, 200)
  assert.equal((await r.json()).chainId, 8453)
  pass('existing production health behavior preserved')
  console.log(
    `Activation: ${count} native LOCAL SIMULATION checks passed; no live RPC, facilitator, upstream or transactions.`,
  )
} catch (e) {
  console.error('Activation failure:', e)
  console.error(runtime.diagnostic().slice(-3500))
  process.exitCode = 1
} finally {
  await runtime.close()
  await new Promise((r) => mock.close(r))
}
