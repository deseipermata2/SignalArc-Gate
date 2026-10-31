import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import { execFileSync } from 'node:child_process'
import { mkdtemp, rm, readFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { keccak256, toHex, verifyTypedData } from 'viem'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { localRuntime } from '../../scripts/local-runtime.mjs'

const root = resolve(import.meta.dirname, '../..')
const network = 'eip155:8453',
  asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
// Ephemeral, unfunded local signing keys remain in this Node process, never printed or persisted.
const buyer = privateKeyToAccount(generatePrivateKey()),
  other = privateKeyToAccount(generatePrivateKey())
const types = {
  TransferWithAuthorization: [
    { name: 'from', type: 'address' },
    { name: 'to', type: 'address' },
    { name: 'value', type: 'uint256' },
    { name: 'validAfter', type: 'uint256' },
    { name: 'validBefore', type: 'uint256' },
    { name: 'nonce', type: 'bytes32' },
  ],
}
const domain = {
  name: 'USD Coin',
  version: '2',
  chainId: 8453,
  verifyingContract: asset,
}
const digest = (v) =>
  createHash('sha256').update(JSON.stringify(v)).digest('hex')
const identity = (a) =>
  digest([
    network,
    asset.toLowerCase(),
    a.from.toLowerCase(),
    a.nonce.toLowerCase(),
  ])
const clockEpoch = Date.now(),
  clockTick = performance.now()
const localNow = () => Math.floor(clockEpoch + performance.now() - clockTick)
const calls = [],
  ledger = new Map(),
  settlementCounts = new Map()
let mode = {},
  onVerify,
  onSettle,
  onUpstream,
  duplicatedSettles = 0,
  lastTransaction,
  conflictTransaction
function send(res, value, status = 200) {
  if (!res.destroyed) {
    res.writeHead(status, {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store',
    })
    res.end(JSON.stringify(value))
  }
}
const mock = createServer(async (req, res) => {
  try {
    let raw = ''
    for await (const chunk of req) {
      raw += chunk
      if (raw.length > 16384) throw Error('oversized mock body')
    }
    const body = raw ? JSON.parse(raw) : undefined
    const path = req.url,
      scenario = { ...mode }
    calls.push({
      path,
      method: req.method,
      identity: body?.paymentPayload?.payload?.authorization
        ? identity(body.paymentPayload.payload.authorization)
        : undefined,
    })
    if (path === '/clock')
      return send(res, { now: localNow(), localSimulationOnly: true })
    if (path === '/supported')
      return send(res, {
        kinds:
          scenario.supported === 'wrong'
            ? []
            : [{ x402Version: 2, scheme: 'exact', network }],
        extensions: [],
        signers: {},
      })
    if (path === '/reconcile') {
      const entry = ledger.get(body.identity)
      if (!entry)
        return send(res, {
          localSimulationOnly: true,
          identity: body.identity,
          network,
          asset,
          recipient: '',
          amount: '',
          payer: '',
          disposition: 'unknown',
        })
      return send(res, {
        ...entry,
        disposition:
          scenario.reconcile === 'wrong' ? 'unknown' : entry.disposition,
        ...(scenario.reconcile === 'mismatch' ? { amount: '999' } : {}),
      })
    }
    if (path === '/verify' || path === '/settle') {
      const p = body.paymentPayload,
        a = p.payload.authorization,
        reqs = body.paymentRequirements,
        key = identity(a)
      const valid = await verifyTypedData({
        address: a.from,
        domain,
        types,
        primaryType: 'TransferWithAuthorization',
        message: {
          ...a,
          value: BigInt(a.value),
          validAfter: BigInt(a.validAfter),
          validBefore: BigInt(a.validBefore),
        },
        signature: p.payload.signature,
      }).catch(() => false)
      assert.equal(body.x402Version, 2)
      assert.equal(reqs.network, network)
      assert.equal(reqs.asset, asset)
      const which = path === '/verify' ? scenario.verify : scenario.settle
      if (path === '/verify') {
        if (onVerify) await onVerify()
        if (which === 'timeout') await delay(1500)
        if (which === 'drop') return req.socket.destroy()
        if (which === 'http')
          return send(res, { error: 'LOCAL MOCK HTTP ERROR' }, 503)
        if (which === 'malformed') return send(res, { isValid: 'yes' })
        if (which === 'large')
          return send(res, {
            isValid: true,
            payer: a.from,
            padding: 'x'.repeat(9000),
          })
        return send(res, {
          isValid: valid && which !== 'reject',
          payer: which === 'wrong-payer' ? other.address : a.from,
          ...(!valid || which === 'reject'
            ? { invalidReason: 'LOCAL_SIMULATION_REJECTED' }
            : {}),
        })
      }
      const count = (settlementCounts.get(key) ?? 0) + 1
      settlementCounts.set(key, count)
      if (count > 1) {
        duplicatedSettles++
        return send(res, {
          success: false,
          transaction: '',
          network,
          errorReason: 'duplicate_local_submission',
        })
      }
      if (!valid)
        return send(res, {
          success: false,
          transaction: '',
          network,
          errorReason: 'local_simulation_rejected_before_submission',
          extra: { submitted: false, localSimulationOnly: true },
        })
      if (which === 'drop-not-submitted') {
        ledger.set(key, {
          localSimulationOnly: true,
          identity: key,
          network,
          asset,
          recipient: reqs.payTo,
          amount: reqs.amount,
          payer: a.from.toLowerCase(),
          disposition: 'not_submitted',
        })
        return req.socket.destroy()
      }
      if (which === 'reject') {
        ledger.set(key, {
          localSimulationOnly: true,
          identity: key,
          network,
          asset,
          recipient: reqs.payTo,
          amount: reqs.amount,
          payer: a.from.toLowerCase(),
          disposition: 'not_submitted',
        })
        return send(res, {
          success: false,
          transaction: '',
          network,
          payer: a.from,
          amount: reqs.amount,
          errorReason: 'local_simulation_rejected_before_submission',
          extra: { submitted: false, localSimulationOnly: true },
        })
      }
      const transaction =
        which === 'conflict'
          ? conflictTransaction
          : keccak256(toHex(`LOCAL SIMULATION ONLY:${key}`))
      const settlement = {
        success: true,
        transaction,
        network,
        payer: a.from,
        amount: reqs.amount,
        extra: { localSimulationOnly: true, asset, recipient: reqs.payTo },
      }
      lastTransaction = transaction
      ledger.set(key, {
        localSimulationOnly: true,
        identity: key,
        network,
        asset,
        recipient: reqs.payTo,
        amount: reqs.amount,
        payer: a.from.toLowerCase(),
        disposition: 'settled',
        settlement,
      })
      if (onSettle) await onSettle()
      if (which === 'timeout') await delay(1500)
      if (which === 'drop') return req.socket.destroy()
      if (which === 'http')
        return send(
          res,
          { error: 'LOCAL HTTP ERROR AFTER POSSIBLE SUBMISSION' },
          503,
        )
      if (which === 'malformed') return send(res, { success: 'yes' })
      if (which === 'wrong-network')
        return send(res, { ...settlement, network: 'eip155:0' })
      if (which === 'wrong-asset')
        return send(res, {
          ...settlement,
          extra: { ...settlement.extra, asset: other.address },
        })
      if (which === 'wrong-recipient')
        return send(res, {
          ...settlement,
          extra: { ...settlement.extra, recipient: other.address },
        })
      if (which === 'wrong-amount')
        return send(res, { ...settlement, amount: '1001' })
      if (which === 'wrong-payer')
        return send(res, { ...settlement, payer: other.address })
      if (which === 'empty-hash')
        return send(res, { ...settlement, transaction: '' })
      if (which === 'false-with-hash')
        return send(res, {
          ...settlement,
          success: false,
          errorReason: 'conflicting_local_result',
        })
      if (which === 'ambiguous')
        return send(res, {
          success: false,
          transaction: '',
          network,
          errorReason: 'unknown_local_submission',
        })
      if (which === 'redirect') {
        res.writeHead(302, { Location: 'https://example.invalid/settle' })
        return res.end()
      }
      return send(res, settlement)
    }
    if (path === '/upstream') {
      assert.equal(req.method, 'GET')
      assert.equal(req.headers.cookie, undefined)
      assert.equal(req.headers.authorization, undefined)
      assert.equal(req.headers['payment-signature'], undefined)
      if (onUpstream) await onUpstream()
      if (scenario.upstream === 'timeout') await delay(1500)
      if (scenario.upstream === 'drop') return req.socket.destroy()
      if (scenario.upstream === 'error')
        return send(res, { localSimulationOnly: true }, 503)
      if (scenario.upstream === 'redirect') {
        res.writeHead(302, {
          Location: 'http://169.254.169.254/latest/meta-data/',
        })
        return res.end()
      }
      if (scenario.upstream === 'content-type') {
        res.writeHead(200, { 'Content-Type': 'text/html' })
        return res.end('<p>LOCAL TEST</p>')
      }
      if (scenario.upstream === 'malformed') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        return res.end('{')
      }
      if (scenario.upstream === 'large')
        return send(res, { value: 'x'.repeat(5000) })
      if (scenario.upstream === 'collection')
        return send(
          res,
          Array.from({ length: 65 }, () => 1),
        )
      if (scenario.upstream === 'depth')
        return send(res, JSON.parse('['.repeat(10) + '1' + ']'.repeat(10)))
      if (scenario.upstream === 'stream-large') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        res.write('{"value":"')
        return res.end('x'.repeat(5000) + '"}')
      }
      if (scenario.upstream === 'slow-body') {
        res.writeHead(200, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
        })
        res.write('{')
        await delay(1500)
        return res.end('}')
      }
      return send(res, {
        localSimulationOnly: true,
        message: 'LOCAL protected JSON fixture',
      })
    }
    send(res, { error: 'unknown_mock_path' }, 404)
  } catch {
    send(res, { error: 'local_mock_error' }, 500)
  }
})
await new Promise((done, reject) => {
  mock.once('error', reject)
  mock.listen(0, '127.0.0.1', done)
})
const mockOrigin = `http://127.0.0.1:${mock.address().port}`
const state = await mkdtemp(join(root, '.wrangler/sg05-state-'))
let runtime,
  ordinary,
  passed = 0,
  resourceCount = 0,
  paymentCount = 0
const pass = (name) => {
  passed++
  console.log(`PASS ${name}`)
}
const fixture = {
  module: join(root, 'tests/sg05/handler.ts'),
  bindings: {
    SG05_LOCAL_ONLY: 'yes',
    MOCK_ORIGIN: mockOrigin,
    CF_PAGES_URL: 'http://127.0.0.1',
  },
}
async function control(action, fields = {}) {
  const r = await fetch(`${runtime.origin}/sg05/control`, {
    method: 'POST',
    redirect: 'error',
    headers: {
      Origin: runtime.origin,
      'X-Local-Only': 'yes',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, ...fields }),
  })
  const body = await r.json()
  assert.equal(
    r.status,
    200,
    `local control ${action}: ${body.error ?? 'unexpected status'}`,
  )
  return body
}
function reset() {
  mode = {}
  onVerify = undefined
  onSettle = undefined
  onUpstream = undefined
}
async function seed(owner = buyer.address) {
  const id = `10000000-0000-4000-8000-${(++resourceCount).toString(16).padStart(12, '0')}`
  await control('seed', { id, owner })
  return id
}
async function issue(id) {
  const r = await fetch(`${runtime.origin}/sg05/pay/${id}`, {
    redirect: 'error',
  })
  if (r.status !== 402)
    throw Error(`challenge HTTP ${r.status}: ${(await r.json()).error}`)
  const c = await r.json()
  assert.equal(c.x402Version, 2)
  assert.equal(c.accepts.length, 1)
  assert.equal(c.accepts[0].extra.paymentFlow, 'upfront')
  assert.equal(c.accepts[0].asset, asset)
  assert.equal(c.accepts[0].amount, '1000')
  assert.equal(r.headers.get('payment-response'), null)
  assert.deepEqual(
    JSON.parse(Buffer.from(r.headers.get('payment-required'), 'base64')),
    c,
  )
  return {
    challenge: c,
    url: c.resource.url,
    id: new URL(c.resource.url).searchParams.get('attempt'),
    resource: id,
  }
}
async function signed(t, transform = () => {}, signer = buyer) {
  const now = Math.floor(localNow() / 1000),
    q = t.challenge.accepts[0]
  const a = {
    from: buyer.address,
    to: q.payTo,
    value: q.amount,
    validAfter: String(now - 10),
    validBefore: String(now + 60),
    nonce: keccak256(toHex(`LOCAL AUTH ${++paymentCount}`)),
  }
  const payload = {
    x402Version: 2,
    resource: t.challenge.resource,
    accepted: structuredClone(q),
    payload: { authorization: a, signature: '0x' },
  }
  transform(payload)
  payload.payload.signature = await signer.signTypedData({
    domain,
    types,
    primaryType: 'TransferWithAuthorization',
    message: {
      ...a,
      value: BigInt(a.value),
      validAfter: BigInt(a.validAfter),
      validBefore: BigInt(a.validBefore),
    },
  })
  return { payload, header: encodePaymentSignatureHeader(payload) }
}
async function submit(t, p, status, options = {}) {
  const r = await fetch(t.url, {
    redirect: 'error',
    headers: {
      'PAYMENT-SIGNATURE': typeof p === 'string' ? p : p.header,
      ...options.headers,
    },
    ...options,
  })
  const body = await r.json()
  assert.equal(r.status, status, `HTTP ${r.status} ${body.error ?? ''}`)
  if (status !== 200) {
    assert.equal(r.headers.get('payment-response'), null)
    assert.equal(body.data, undefined)
  }
  assert.equal(r.headers.get('cache-control'), 'private, no-store, max-age=0')
  return { r, body }
}
const count = (path) => calls.filter((c) => c.path === path).length
const inspect = () => control('inspect')
const attempt = async (t) =>
  (await inspect()).attempts.find((a) => a.id === t.id)
const receipts = async (t) =>
  (await inspect()).receipts.filter((r) => r.attempt_id === t.id)
async function noPayment(t) {
  const data = await inspect()
  assert.equal(data.receipts.filter((r) => r.attempt_id === t.id).length, 0)
  assert.equal(data.analytics.filter((r) => r.attempt_id === t.id).length, 0)
}
try {
  runtime = await localRuntime({
    statePath: state,
    includeApp: true,
    fixture,
    migrationNames: ['0001_sg03.sql'],
  })
  assert.deepEqual((await runtime.control('migrate')).applied, [
    '0001_sg03.sql',
  ])
  await control('legacySeed', { owner: other.address })
  await runtime.close()
  runtime = await localRuntime({ statePath: state, includeApp: true, fixture })
  assert.deepEqual((await runtime.control('migrate')).applied, [
    '0002_sg05.sql',
    '0003_sg06_reporting_indexes.sql',
  ])
  assert.deepEqual((await runtime.control('migrate')).applied, [])
  assert.equal(
    (await inspect()).attempts.find((a) => a.id === 'legacy-local-attempt')
      .phase,
    'legacy_unreconciled',
  )
  pass(
    'forward local D1 migration preserves SG03 rows and legacy payment state; trigger-capable helper is idempotent',
  )
  const modules = await (await fetch(`${runtime.origin}/sg05/modules`)).json()
  assert.equal(modules.cdpCredentialGuard, true)
  assert.equal(
    modules.mappingId,
    '0x8cceed2c37972681854cf4182a58d3364ae687fb42eb43f5907be00ff2928412',
  )
  assert.equal(
    modules.mappingHash,
    '0xe21af1340a6f9664cc72f413627d5b14dd7e44a37ecb3cdc868014badf58594d',
  )
  pass(
    'workerd resource-ID and commitment computation matches the independently reviewed SG04 Solidity/viem vectors',
  )
  assert.deepEqual(
    await (await fetch(`${runtime.origin}/sg05/guards`)).json(),
    { absent: 404, deployed: 404, host: 404 },
  )
  assert.equal(
    (await (await fetch(`${runtime.origin}/sg05/egress`)).json()).blocked,
    4,
  )
  pass(
    'Foundation/CDP modules load with explicit empty-credential guard; local opt-in, host and deployment guards block public/live egress',
  )
  const r = await seed(),
    t = await issue(r)
  assert.equal(count('/verify'), 0)
  assert.equal(count('/settle'), 0)
  assert.equal(count('/upstream'), 0)
  const same = await fetch(t.url)
  assert.equal(same.status, 402)
  assert.deepEqual(await same.json(), t.challenge)
  assert.equal(
    (await (await fetch(`${runtime.origin}/api/resources`)).json()).error,
    'Sign in with Ethereum to continue',
  )
  pass(
    'unpaid buyer needs no merchant SIWE; durable Base-native USDC upfront challenge repeats without verification, settlement or upstream',
  )
  const good = await signed(t),
    ok = await submit(t, good, 200)
  assert.equal(ok.body.localSimulationOnly, true)
  assert.equal(ok.body.data.message, 'LOCAL protected JSON fixture')
  const evidence = JSON.parse(
    Buffer.from(ok.r.headers.get('payment-response'), 'base64'),
  )
  conflictTransaction = evidence.transaction
  assert.equal(evidence.success, true)
  assert.equal(evidence.extra.localSimulationOnly, true)
  assert.equal(count('/verify'), 1)
  assert.equal(count('/settle'), 1)
  assert.equal(count('/upstream'), 1)
  assert.equal((await attempt(t)).phase, 'fulfilled')
  assert.equal((await receipts(t)).length, 1)
  assert.equal((await receipts(t))[0].evidence_kind, 'local_simulation')
  assert.equal((await receipts(t))[0].block_number, 'LOCAL_SIMULATION_ONLY')
  const baseline = calls.length
  await submit(t, good, 409)
  assert.equal(calls.length, baseline)
  pass(
    'genuine local EIP3009 signature → facilitator verification → simulated settlement → atomic D1 receipt/analytics → JSON; replay returns no content',
  )
  const q = await issue(r),
    qp = await signed(q)
  const before = {
    v: count('/verify'),
    s: count('/settle'),
    u: count('/upstream'),
  }
  const outcomes = await Promise.all(
    Array.from({ length: 6 }, () =>
      fetch(q.url, { headers: { 'PAYMENT-SIGNATURE': qp.header } }),
    ),
  )
  assert.equal(outcomes.filter((x) => x.status === 200).length, 1)
  assert.equal(outcomes.filter((x) => x.status === 409).length, 5)
  for (const response of outcomes) await response.arrayBuffer()
  assert.equal(count('/verify') - before.v, 1)
  assert.equal(count('/settle') - before.s, 1)
  assert.equal(count('/upstream') - before.u, 1)
  assert.equal((await receipts(q)).length, 1)
  pass(
    'six concurrent paid requests produce exactly one verify, settlement initiator, receipt and protected response',
  )

  // More cases below keep using fresh resources/attempts in this same isolated database.
  reset()
  {
    const t = await issue(await seed()),
      p = await signed(t)
    const alias = { ...t, url: `${runtime.origin}/sg05/pay/${t.resource}` }
    const s = count('/settle'),
      u = count('/upstream')
    await submit(alias, p, 200)
    assert.equal((await attempt(t)).phase, 'fulfilled')
    await submit(alias, p, 409)
    assert.equal(count('/settle') - s, 1)
    assert.equal(count('/upstream') - u, 1)
    pass(
      'standard original-URL x402 retry resolves only its D1-issued envelope ticket; duplicate retry cannot settle or fulfill again',
    )
  }
  for (const [name, transform] of [
    ['x402 version', (p) => (p.x402Version = 1)],
    ['scheme', (p) => (p.accepted.scheme = 'upto')],
    ['network', (p) => (p.accepted.network = 'eip155:0')],
    ['non-native asset', (p) => (p.accepted.asset = other.address)],
    ['amount', (p) => (p.accepted.amount = '1001')],
    ['payee', (p) => (p.accepted.payTo = other.address)],
    [
      'resource identity',
      (p) => (p.resource = { ...p.resource, url: p.resource.url + '/changed' }),
    ],
    ['authorization value', (p) => (p.payload.authorization.value = '1001')],
    [
      'authorization recipient',
      (p) => (p.payload.authorization.to = other.address),
    ],
    [
      'expired authorization',
      (p) =>
        (p.payload.authorization.validBefore = String(
          Math.floor(localNow() / 1000) - 1,
        )),
    ],
    [
      'future authorization',
      (p) =>
        (p.payload.authorization.validAfter = String(
          Math.floor(localNow() / 1000) + 30,
        )),
    ],
  ]) {
    reset()
    const n = await issue(await seed()),
      p = await signed(n, transform)
    const v = count('/verify'),
      s = count('/settle'),
      u = count('/upstream')
    await submit(n, p, 402)
    assert.equal(count('/verify'), v)
    assert.equal(count('/settle'), s)
    assert.equal(count('/upstream'), u)
    await noPayment(n)
    pass(
      `rejects ${name} before facilitator or content; no receipt/settlement analytics`,
    )
  }
  for (const [name, header, status] of [
    ['malformed base64', '!', 400],
    ['malformed JSON', Buffer.from('{').toString('base64'), 400],
    ['oversized payment header', 'a'.repeat(8200), 413],
    [
      'nested JSON',
      Buffer.from('['.repeat(10) + '1' + ']'.repeat(10)).toString('base64'),
      413,
    ],
    [
      'collection',
      Buffer.from(JSON.stringify(Array.from({ length: 65 }, () => 1))).toString(
        'base64',
      ),
      413,
    ],
    [
      'large string',
      Buffer.from(JSON.stringify({ value: 'x'.repeat(3000) })).toString(
        'base64',
      ),
      413,
    ],
    [
      'node count',
      Buffer.from(
        JSON.stringify(
          Array.from({ length: 32 }, () => Array.from({ length: 32 }, () => 1)),
        ),
      ).toString('base64'),
      413,
    ],
  ]) {
    const n = await issue(await seed()),
      s = count('/settle')
    await submit(n, header, status)
    assert.equal(count('/settle'), s)
    await noPayment(n)
    pass(`bounded parsing rejects ${name} before SDK validation/settlement`)
  }
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n, () => {}, other),
      s = count('/settle')
    await submit(n, p, 402)
    assert.equal(count('/settle'), s)
    assert.equal((await attempt(n)).phase, 'rejected')
    await noPayment(n)
    pass(
      'authoritative local facilitator cryptographically rejects a signature from a different local key',
    )
  }
  for (const verify of [
    'reject',
    'wrong-payer',
    'malformed',
    'large',
    'http',
    'timeout',
    'drop',
  ]) {
    reset()
    mode.verify = verify
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle'),
      u = count('/upstream')
    await submit(n, p, ['reject', 'wrong-payer'].includes(verify) ? 402 : 502)
    assert.equal(count('/settle'), s)
    assert.equal(count('/upstream'), u)
    await noPayment(n)
    pass(`facilitator verification ${verify} never settles or releases content`)
  }
  reset()
  {
    const n = await issue(await seed(other.address)),
      original = structuredClone(good.payload)
    original.resource = n.challenge.resource
    original.accepted = n.challenge.accepts[0]
    const v = count('/verify')
    await submit(n, { header: encodePaymentSignatureHeader(original) }, 409)
    assert.equal(count('/verify'), v)
    assert.equal((await attempt(n)).phase, 'rejected')
    await noPayment(n)
    pass(
      'same EIP3009 identity cannot be replayed across resource and merchant boundaries, despite matching price/payee',
    )
  }
  for (const settle of [
    'reject',
    'ambiguous',
    'malformed',
    'http',
    'drop',
    'wrong-network',
    'wrong-asset',
    'wrong-recipient',
    'wrong-amount',
    'wrong-payer',
    'empty-hash',
    'false-with-hash',
    'redirect',
    'conflict',
  ]) {
    reset()
    mode.settle = settle
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle'),
      u = count('/upstream')
    const rejected = await submit(n, p, 503)
    assert.equal(count('/settle') - s, 1, rejected.body.error)
    assert.equal(count('/upstream'), u)
    await noPayment(n)
    assert.equal(
      (await attempt(n)).phase,
      settle === 'reject' ? 'failed' : 'settlement_unknown',
    )
    await submit(n, p, 409)
    assert.equal(count('/settle') - s, 1)
    pass(
      `settlement ${settle} persists ${settle === 'reject' ? 'definitive failure' : 'unknown outcome'} without a fabricated receipt, fulfillment or automatic resubmission`,
    )
  }
  reset()
  {
    mode.settle = 'timeout'
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await submit(n, p, 503)
    assert.equal((await attempt(n)).phase, 'settlement_unknown')
    await noPayment(n)
    await submit(n, p, 409)
    assert.equal(count('/settle') - s, 1)
    mode = { reconcile: 'mismatch' }
    const bad = await fetch(`${runtime.origin}/sg05/control`, {
      method: 'POST',
      headers: {
        Origin: runtime.origin,
        'X-Local-Only': 'yes',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ action: 'reconcile', id: n.id }),
    })
    assert.equal(bad.status, 503)
    await bad.arrayBuffer()
    await noPayment(n)
    mode = {}
    assert.equal((await control('reconcile', { id: n.id })).outcome, 'settled')
    assert.equal((await receipts(n)).length, 1)
    const forged = structuredClone(p.payload)
    forged.payload.signature = '0x' + '11'.repeat(65)
    await submit(n, { header: encodePaymentSignatureHeader(forged) }, 409)
    assert.equal((await attempt(n)).phase, 'settled')
    await submit(n, p, 200)
    assert.equal(count('/settle') - s, 1)
    await submit(n, p, 409)
    pass(
      'timeout after possible submission reconciles only from server-side local ledger evidence; resumes fulfillment without a second settlement',
    )
  }
  reset()
  {
    mode.settle = 'drop-not-submitted'
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await submit(n, p, 503)
    assert.equal((await attempt(n)).phase, 'settlement_unknown')
    reset()
    assert.equal((await control('reconcile', { id: n.id })).outcome, 'failed')
    await noPayment(n)
    await submit(n, p, 409)
    assert.equal(count('/settle') - s, 1)
    pass(
      'authoritative local not-submitted reconciliation resolves unknown to failed without a receipt or another charge',
    )
  }
  for (const field of ['price_atomic', 'payout_address', 'enabled']) {
    reset()
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await control('mutate', {
      id: n.resource,
      field,
      value:
        field === 'enabled'
          ? 0
          : field === 'price_atomic'
            ? '2000'
            : other.address,
    })
    await submit(n, p, 409)
    assert.equal(count('/settle'), s)
    await noPayment(n)
    pass(`challenge becomes unusable after persisted ${field} change`)
  }
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await control('mutate', { id: n.resource, field: 'enabled', value: 0 })
    await control('mutate', { id: n.resource, field: 'enabled', value: 1 })
    await submit(n, p, 409)
    assert.equal(count('/settle'), s)
    pass(
      'monotonic D1 revision rejects disable/re-enable ABA even when configuration values are restored',
    )
  }
  for (const patch of [
    { owner: other.address },
    { version: '2' },
    { enabled: false },
    { pendingOwner: other.address },
    { observedAt: 1 },
    { configHash: '0x' + '00'.repeat(32) },
    { payout: other.address },
    { priceAtomic: '2000' },
  ]) {
    reset()
    const id = await seed()
    await control('registryPatch', { id, patch })
    const before = count('/settle')
    const response = await fetch(`${runtime.origin}/sg05/pay/${id}`)
    assert.equal(response.status, 409)
    await response.arrayBuffer()
    assert.equal(count('/settle'), before)
    pass(
      `simulated registry mismatch (${Object.keys(patch)[0]}) fails closed before issuing a payable challenge`,
    )
  }
  for (const bindingMode of ['delete', 'stale', 'unconfirmed']) {
    const id = await seed()
    await control('binding', { id, mode: bindingMode })
    const response = await fetch(`${runtime.origin}/sg05/pay/${id}`)
    assert.equal(response.status, 503)
    await response.arrayBuffer()
    pass(`missing/unusable registry binding ${bindingMode} fails closed`)
  }
  for (const value of [
    'http://127.0.0.1/',
    'https://127.0.0.1/',
    'https://0x7f000001/',
    'https://[::1]/',
    'https://169.254.169.254/',
    'https://10.0.0.1/',
    'https://user:password@example.com/',
    'https://example.com:8443/',
  ]) {
    reset()
    const id = await seed(),
      u = count('/upstream')
    await control('mutate', { id, field: 'upstream_url', value })
    const response = await fetch(`${runtime.origin}/sg05/pay/${id}`)
    assert.notEqual(response.status, 402)
    assert.notEqual(response.status, 200)
    await response.arrayBuffer()
    assert.equal(count('/upstream'), u)
  }
  pass(
    'existing HTTPS validator remains enforced for local/private/link-local/IPv6/alternate-IP URLs, credentials and ports; production has no DNS-unsafe fetch transport',
  )
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    onVerify = () =>
      control('mutate', { id: n.resource, field: 'enabled', value: 0 })
    await submit(n, p, 409)
    assert.equal(count('/settle'), s)
    await noPayment(n)
    assert.equal((await attempt(n)).phase, 'failed')
    pass('disable during facilitator verification aborts before settlement')
  }
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n),
      u = count('/upstream')
    onSettle = () =>
      control('mutate', { id: n.resource, field: 'enabled', value: 0 })
    await submit(n, p, 409)
    assert.equal(count('/upstream'), u)
    assert.equal((await receipts(n)).length, 1)
    assert.equal((await attempt(n)).phase, 'fulfillment_failed')
    pass(
      'disable during settlement retains genuine simulated settlement evidence but never fetches or releases protected content',
    )
  }
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n)
    onUpstream = async () => {
      await control('mutate', { id: n.resource, field: 'enabled', value: 0 })
      await control('mutate', { id: n.resource, field: 'enabled', value: 1 })
    }
    await submit(n, p, 409)
    assert.equal((await attempt(n)).phase, 'fulfillment_failed')
    pass(
      'final D1 revision gate prevents delivery when configuration changes during upstream execution',
    )
  }
  for (const upstream of [
    'error',
    'timeout',
    'drop',
    'redirect',
    'content-type',
    'malformed',
    'large',
    'stream-large',
    'slow-body',
    'depth',
    'collection',
  ]) {
    reset()
    mode.upstream = upstream
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await submit(
      n,
      p,
      upstream === 'timeout' || upstream === 'slow-body'
        ? 504
        : upstream === 'depth' || upstream === 'collection'
          ? 413
          : upstream === 'malformed'
            ? 400
            : upstream === 'drop'
              ? 503
              : 502,
    )
    assert.equal((await attempt(n)).phase, 'fulfillment_failed')
    assert.equal((await receipts(n)).length, 1)
    await submit(n, p, 409)
    assert.equal(count('/settle') - s, 1)
    pass(
      `upstream ${upstream} never releases content or retries payment; settled evidence is retained`,
    )
  }
  for (const fault of ['claim', 'receipt', 'release']) {
    reset()
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    await control('fault', { mode: fault })
    await submit(n, p, 503)
    await control('fault', { mode: 'off' })
    assert.equal(count('/settle') - s, fault === 'claim' ? 0 : 1)
    if (fault === 'receipt') {
      assert.equal((await attempt(n)).phase, 'settlement_unknown')
      await noPayment(n)
    }
    if (fault === 'claim') {
      assert.equal((await attempt(n)).phase, 'created')
      await noPayment(n)
    }
    if (fault === 'release') {
      assert.equal((await attempt(n)).phase, 'fulfillment_failed')
      assert.equal((await receipts(n)).length, 1)
    }
    pass(
      `actual local D1 trigger abort during ${fault} fails closed; receipt and analytics rollback atomically where applicable`,
    )
  }
  reset()
  {
    const n = await issue(await seed())
    assert.equal(
      (await control('illegalTransition', { id: n.id })).blocked,
      true,
    )
    assert.equal((await attempt(n)).phase, 'created')
    const response = await fetch(n.url, {
      headers: { 'PAYMENT-RESPONSE': '0xCLIENT_HASH_IS_NOT_PROOF' },
    })
    assert.equal(response.status, 402)
    await response.arrayBuffer()
    await noPayment(n)
    const malformedTicket = n.url.replace(
      /ticket=(.)/,
      (_, c) => `ticket=${c === 'f' ? 'e' : 'f'}`,
    )
    const missing = await fetch(malformedTicket)
    assert.equal(missing.status, 404)
    await missing.arrayBuffer()
    await control('expire', { id: n.id })
    const p = await signed(n)
    await submit(n, p, 402)
    await noPayment(n)
    pass(
      'D1 rejects illegal transitions; client receipt/hash, altered request ticket and expired challenges confer no authority',
    )
  }
  reset()
  {
    const n = await issue(await seed()),
      p = await signed(n)
    const response = await fetch(n.url, {
      method: 'POST',
      headers: { 'PAYMENT-SIGNATURE': p.header },
      body: 'x'.repeat(17000),
    })
    assert.equal(response.status, 405)
    await response.arrayBuffer()
    await submit(n, p, 413, {
      headers: { 'PAYMENT-SIGNATURE': p.header, 'X-Large': 'x'.repeat(16384) },
    })
    const long = await fetch(
      `${runtime.origin}/sg05/pay/${n.resource}?x=${'x'.repeat(2048)}`,
    )
    assert.equal(long.status, 414)
    await long.arrayBuffer()
    await noPayment(n)
    pass(
      'unsupported methods, oversized total headers/body and URLs cannot initiate payment',
    )
  }
  reset()
  {
    mode.settle = 'timeout'
    const n = await issue(await seed()),
      p = await signed(n),
      s = count('/settle')
    let observed
    const submitted = new Promise((resolve) => {
      observed = resolve
    })
    onSettle = () => observed()
    const pending = fetch(n.url, { headers: { 'PAYMENT-SIGNATURE': p.header } })
      .then((r) => r.arrayBuffer())
      .catch(() => null)
    await submitted
    const port = Number(new URL(runtime.origin).port)
    await runtime.close('SIGKILL')
    await pending
    reset()
    runtime = await localRuntime({
      statePath: state,
      includeApp: true,
      fixture,
      listenPort: port,
    })
    assert.deepEqual((await runtime.control('migrate')).applied, [])
    assert.equal((await attempt(n)).phase, 'settlement_pending')
    await control('expire', { id: n.id })
    await control('recover')
    assert.equal((await attempt(n)).phase, 'settlement_unknown')
    await submit(n, p, 409)
    assert.equal(count('/settle') - s, 1)
    await control('reconcile', { id: n.id })
    await submit(n, p, 200)
    assert.equal(count('/settle') - s, 1)
    pass(
      'real Pages process interruption preserves pending D1 state; restart recovery reconciles without another settlement and fulfills once',
    )
  }
  reset()
  {
    mode.supported = 'wrong'
    const id = await seed()
    const r = await fetch(`${runtime.origin}/sg05/pay/${id}`)
    assert.equal(r.status, 503)
    await r.arrayBuffer()
    pass('facilitator discovery without Base exact support fails closed')
  }
  ordinary = await localRuntime({ includeApp: true })
  await ordinary.control('migrate')
  const health = await fetch(`${ordinary.origin}/api/health`)
  assert.equal(health.status, 200)
  assert.deepEqual(await health.json(), {
    status: 'ok',
    service: 'SignalArc Gate',
    network: 'base-mainnet',
    chainId: 8453,
  })
  for (const path of [
    '/sg05/pay/10000000-0000-4000-8000-000000000001',
    '/sg05/control',
    '/api/pay/10000000-0000-4000-8000-000000000001',
    '/api/gateway',
  ]) {
    const response = await fetch(ordinary.origin + path, {
      method: 'POST',
      headers: {
        SG05_LOCAL_ONLY: 'yes',
        'PAYMENT-SIGNATURE': good.header,
        'X-Local-Only': 'yes',
        'Content-Type': 'application/json',
      },
      body: '{}',
    })
    assert.equal(response.headers.get('payment-response'), null)
    assert.equal(response.headers.get('x-signalarc-mode'), null)
    assert.notEqual(response.status, 200)
    await response.arrayBuffer()
  }
  const meta = join(root, '.wrangler/sg05-production-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/sg05-production-build'),
      '--metafile',
      meta,
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: 'pipe',
    },
  )
  const inputs = Object.keys(JSON.parse(await readFile(meta, 'utf8')).inputs)
  assert.equal(
    inputs.some(
      (p) =>
        p.includes('server/sg05') ||
        p.includes('tests/') ||
        p.includes('@x402') ||
        p.includes('@coinbase'),
    ),
    false,
  )
  assert.equal(duplicatedSettles, 0)
  const db = await inspect()
  assert.equal(
    db.bindings.every(
      (b) =>
        ['local_simulation', 'unconfirmed'].includes(b.source) &&
        b.registry_address === null &&
        b.block_hash === null &&
        b.block_number === null,
    ),
    true,
  )
  assert.equal(
    db.receipts.every(
      (r) =>
        r.evidence_kind === 'local_simulation' &&
        r.block_number === 'LOCAL_SIMULATION_ONLY',
    ),
    true,
  )
  assert.equal(
    db.analytics.every(
      (e) =>
        e.event_type === 'payment_settled' &&
        e.evidence_kind === 'local_simulation' &&
        db.receipts.some((r) => r.attempt_id === e.attempt_id),
    ),
    true,
  )
  pass(
    'actual production Functions bundle/tree excludes SG05 fixtures/payment SDKs; forged flags cannot enable public fulfillment; all persisted successes remain labeled simulations',
  )
  console.log(
    `${passed} SG-05 checks passed in native Pages/workerd + real local D1. LOCAL SIMULATION ONLY; duplicate settlement initiations: ${duplicatedSettles}.`,
  )
  console.log(
    `Local mock HTTP counts: ${JSON.stringify(Object.fromEntries(['/supported', '/verify', '/settle', '/reconcile', '/upstream', '/clock'].map((p) => [p, count(p)])))}`,
  )
} finally {
  await ordinary?.close()
  await runtime?.close()
  mock.closeAllConnections()
  await new Promise((done) => mock.close(done))
  await rm(state, { recursive: true, force: true })
}
