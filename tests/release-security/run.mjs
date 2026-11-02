import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { localRuntime } from '../../scripts/local-runtime.mjs'
const root = resolve(import.meta.dirname, '../..')
const runtime = await localRuntime({
  includeApp: true,
  fixture: {
    prefix: 'release-security',
    module: join(root, 'tests/release-security/handler.ts'),
    bindings: { RELEASE_LOCAL_ONLY: 'yes' },
  },
})
let count = 0
const pass = (s) => {
  count++
  console.log('PASS ' + s)
}
// Ephemeral, unfunded local EIP-712 signing only. Key stays in Node memory and is never logged/persisted.
const signer = privateKeyToAccount(generatePrivateKey())
const stamp = BigInt(Date.parse('2026-11-02T00:00:00Z') / 1000)
const signature = await signer.signTypedData({
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
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
  primaryType: 'TransferWithAuthorization',
  message: {
    from: signer.address,
    to: '0x000000000000000000000000000000000000b0b1',
    value: 1000n,
    validAfter: stamp - 100n,
    validBefore: stamp + 100n,
    nonce: '0x' + '11'.repeat(32),
  },
})
const receiveSignature = await signer.signTypedData({
  domain: {
    name: 'USD Coin',
    version: '2',
    chainId: 8453,
    verifyingContract: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
  },
  types: {
    ReceiveWithAuthorization: [
      { name: 'from', type: 'address' },
      { name: 'to', type: 'address' },
      { name: 'value', type: 'uint256' },
      { name: 'validAfter', type: 'uint256' },
      { name: 'validBefore', type: 'uint256' },
      { name: 'nonce', type: 'bytes32' },
    ],
  },
  primaryType: 'ReceiveWithAuthorization',
  message: {
    from: signer.address,
    to: '0x000000000000000000000000000000000000b0b1',
    value: 1000n,
    validAfter: stamp - 100n,
    validBefore: stamp + 100n,
    nonce: '0x' + '11'.repeat(32),
  },
})
async function invoke(action, mode, extra = {}) {
  const r = await fetch(runtime.origin + '/release-security/control', {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'X-Local-Only': 'yes',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      action,
      mode,
      payer: signer.address,
      signature: mode === 'receive' ? receiveSignature : signature,
      ...extra,
    }),
  })
  return { status: r.status, body: await r.json() }
}
try {
  assert.equal(
    (await runtime.control('migrate')).applied.at(-1),
    '0006_sg07_api_budget.sql',
  )
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  pass(
    'six forward migrations apply in real local D1 and repeat with matching historical digests',
  )
  const good = await invoke('evidence', 'ok')
  assert.equal(good.status, 200, JSON.stringify(good.body))
  assert.equal(good.body.result.evidence, 'rpc_observation_only')
  assert.equal(good.body.result.productionAdmitted, false)
  assert.equal(good.body.result.amount, '1000')
  assert.equal(good.body.result.sourceId, 'LOCAL_SIMULATION_ONLY')
  assert.equal(good.body.calls, 8)
  assert.equal(good.body.receipts.n, 0)
  pass(
    'direct-USDC fixture receipt, calldata, nonce identity, events, consumed authorization and canonical finality match; observation cannot create a receipt',
  )
  const classic = await invoke('evidence', 'classic')
  assert.equal(classic.status, 200, JSON.stringify(classic.body))
  assert.equal(classic.body.calls, 8)
  assert.equal(
    classic.body.result.authorizationKey,
    good.body.result.authorizationKey,
  )
  assert.equal(classic.body.receipts.n, 0)
  pass(
    'classic v/r/s and bytes authorization calldata recover the same genuine local signer without admitting a receipt',
  )
  const received = await invoke('evidence', 'receive')
  assert.equal(received.status, 200, JSON.stringify(received.body))
  assert.equal(received.body.calls, 8)
  assert.equal(
    received.body.result.authorizationKey,
    good.body.result.authorizationKey,
  )
  assert.equal(received.body.receipts.n, 0)
  pass(
    'receiveWithAuthorization requires its distinct genuine signature and recipient caller while retaining the same nonce identity',
  )
  for (const mode of [
    'policy-chain',
    'policy-asset',
    'policy-finality',
    'policy-source',
    'expected-network',
    'expected-asset',
    'identity',
    'fingerprint',
    'payer',
    'recipient',
    'amount',
    'removed',
    'missing-auth-log',
    'missing-transfer',
    'duplicate-log',
    'log-emitter',
    'log-block',
    'router',
    'calldata',
    'tx-hash',
    'receipt-hash',
    'tx-block',
    'rpc-error',
    'rpc-hung',
    'chain',
    'unfinalized',
    'reorg',
    'stale',
    'missing',
    'nonce-unused',
    'zero-hash',
    'reverted',
    'clock-malformed',
    'invalid-signature',
    'eth-value',
    'receive-wrong-signature',
  ]) {
    const result = await invoke('evidence', mode)
    assert.equal(result.status, 503, mode + JSON.stringify(result.body))
    assert.equal(result.body.result, undefined)
    assert.ok(!JSON.stringify(result.body).includes('PRIVATE_DIAGNOSTIC'))
    pass(
      'settlement observation rejects ' +
        mode +
        ' without admission or provider diagnostic leakage',
    )
  }
  const projected = await invoke('receipt', 'ok')
  assert.equal(projected.status, 200)
  assert.equal(projected.body.extra.localSimulationOnly, true)
  assert.equal(projected.body.extra.asset, good.body.result.asset)
  assert.equal(
    JSON.stringify(projected.body).includes('PRIVATE_DIAGNOSTIC'),
    false,
  )
  assert.equal(
    JSON.stringify(projected.body).includes('BEARER_SENTINEL'),
    false,
  )
  assert.equal((await invoke('receipt', 'rejected')).body.success, false)
  pass(
    'the shared persisted/recovered receipt header projection preserves payment fields and excludes arbitrary provider diagnostics and bearer metadata',
  )
  assert.equal((await invoke('budget', 'reset')).body.outcomes[0], 200)
  const raced = await invoke('budget', 'concurrent')
  assert.equal(raced.body.outcomes.filter((x) => x === 200).length, 1)
  assert.equal(raced.body.outcomes.filter((x) => x === 429).length, 7)
  assert.equal(raced.body.rows.length, 1)
  assert.equal(raced.body.rows[0].minute_hits, 2)
  pass(
    'native D1 concurrent budget claims have one remaining winner, seven denials and one fixed row',
  )
  const epoch = Date.parse('2026-11-02T00:00:00Z')
  assert.deepEqual(
    (await invoke('budget', 'one', { time: epoch - 60000 })).body.outcomes,
    [429],
  )
  pass('backward clocks cannot reset the persisted rate budget')
  assert.deepEqual(
    (await invoke('budget', 'one', { time: epoch + 60000 })).body.outcomes,
    [200],
  )
  assert.deepEqual(
    (await invoke('budget', 'one', { time: epoch + 120000 })).body.outcomes,
    [429],
  )
  pass('minute rollover resets only its window and cannot bypass the daily cap')
  assert.deepEqual(
    (await invoke('budget', 'one', { time: epoch + 86400000 })).body.outcomes,
    [200],
  )
  pass('explicit next-day budget rollover retains bounded single-row storage')
  assert.deepEqual(
    (await invoke('budget', 'one', { time: -1 })).body.outcomes,
    [503],
  )
  pass('malformed budget time denies admission')
  const beforeFault = (await invoke('budget', 'one', { time: -1 })).body.rows
  const fault = await invoke('budget', 'fault')
  assert.deepEqual(fault.body.outcomes, [503])
  assert.deepEqual(fault.body.rows, beforeFault)
  await invoke('budget', 'off')
  pass(
    'actual D1 interruption cannot partially consume or grant a budget claim',
  )
  await invoke('budget', 'exhaust')
  const limited = await fetch(runtime.origin + '/api/auth/session', {
    headers: { 'X-Budget-Limit': '999999', RELEASE_LOCAL_ONLY: 'yes' },
  })
  assert.equal(limited.status, 429)
  await limited.arrayBuffer()
  assert.equal((await fetch(runtime.origin + '/api/health')).status, 200)
  pass(
    'real deployable API enforces its server-owned budget despite forged headers; health remains available',
  )
  await invoke('budget', 'reset')
  for (const [mode, status] of [
    ['ok', 200],
    ['slow', 408],
    ['bad-length', 400],
    ['collection', 413],
    ['nodes', 413],
  ]) {
    const result = await invoke('json', mode)
    assert.equal(result.status, status, mode + JSON.stringify(result.body))
    if (mode === 'slow') assert.equal(result.body.canceled, true)
    pass(
      'native bounded request parser handles ' +
        mode +
        ' with expected cancellation/structure policy',
    )
  }
  for (const mode of ['hung', 'backward']) {
    const result = await invoke('rpc-clock', mode)
    assert.equal(result.status, 503)
    assert.equal(result.body.calls, mode === 'hung' ? 0 : 1)
    pass(
      'RPC ' +
        mode +
        ' clock is inside the deadline and cannot authorize an observation',
    )
  }
  const meta = join(root, '.wrangler/release-security-public-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/release-security-public'),
      '--metafile',
      meta,
    ],
    { cwd: root, stdio: 'pipe' },
  )
  const inputs = Object.keys(JSON.parse(await readFile(meta, 'utf8')).inputs)
  assert.ok(inputs.some((p) => p.includes('server/sg03/budget')))
  assert.equal(
    inputs.some((p) =>
      /server\/sg0[57]|tests\/|@coinbase|@x402|\/zod\//.test(p),
    ),
    false,
  )
  for (const path of [
    '/api/pay/x',
    '/api/gateway',
    '/api/reconcile',
    '/api/release-security',
  ]) {
    const response = await fetch(runtime.origin + path, {
      method: 'POST',
      headers: {
        Origin: runtime.origin,
        'X-SignalArc-Request': '1',
        RELEASE_LOCAL_ONLY: 'yes',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ mode: 'ok', productionAdmitted: true }),
    })
    assert.equal(response.status, 404)
    assert.equal(response.headers.get('PAYMENT-RESPONSE'), null)
    await response.arrayBuffer()
  }
  assert.equal((await fetch(runtime.origin + '/api/health')).status, 200)
  pass(
    'actual production Functions include the budget but exclude fixtures, observer, mock gateway and payment SDKs; forged flags cannot publish payments',
  )
  console.log(
    `${count} release-security checks passed in native local workerd and D1. LOCAL SIMULATION ONLY; no live chain, facilitator or upstream egress.`,
  )
} finally {
  await runtime.close()
}
