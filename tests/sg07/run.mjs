import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { encodePaymentSignatureHeader } from '@x402/core/http'
import { localRuntime } from '../../scripts/local-runtime.mjs'
const root = resolve(import.meta.dirname, '../..')
const runtime = await localRuntime({
  includeApp: true,
  controls: true,
  fixture: {
    prefix: 'sg07',
    module: join(root, 'tests/sg07/handler.ts'),
    bindings: { SG07_LOCAL_ONLY: 'yes' },
  },
})
let count = 0
const pass = (s) => {
  count++
  console.log('PASS ' + s)
}
async function invoke(path, mode, extra = {}) {
  const r = await fetch(runtime.origin + '/sg07/' + path, {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'X-Local-Only': 'yes',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ mode, ...extra }),
  })
  return { status: r.status, body: await r.json() }
}
try {
  await runtime.control('migrate')
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  pass('actual local D1 migrations apply and repeat with unchanged history')
  const good = await invoke('registry', 'ok')
  assert.equal(good.status, 200)
  assert.equal(good.body.result.evidence, 'rpc_observation_only')
  assert.equal(good.body.result.priceAtomic, '1000')
  assert.equal(good.body.result.blockNumber, '100')
  assert.equal(good.body.calls, 7)
  pass(
    'Base-only read adapter validates code hash, ABI, owner-namespaced identity and finalized hash-pinned consistent resource state in workerd',
  )
  for (const mode of [
    'missing-address',
    'zero-address',
    'wrong-chain-policy',
    'wrong-token',
    'missing-codehash',
    'no-finality',
    'bad-depth',
    'disabled-d1',
    'zero-uuid',
    'wrong-chain',
    'unconfirmed',
    'stale-block',
    'null-block',
    'bad-quantity',
    'code-mismatch',
    'transferred',
    'pending-transfer',
    'stale-version',
    'disabled-chain',
    'wrong-payout',
    'wrong-price',
    'wrong-hash',
    'bad-abi',
    'reorg',
    'timeout',
    'hung',
    'http',
    'redirect',
    'malformed',
    'oversized',
    'wrong-rpc-id',
    'rpc-error',
  ]) {
    const r = await invoke('registry', mode)
    assert.equal(r.status, 503, mode)
    assert.equal(
      /secret|diagnostic|private provider/.test(JSON.stringify(r.body)),
      false,
    )
    pass(
      'registry rejects ' +
        mode +
        ' without fulfillment or provider diagnostic leakage',
    )
  }
  assert.equal(
    (await invoke('binding', 'missing')).body.error,
    'registry_binding_unconfirmed',
  )
  pass(
    'actual empty D1 registry binding fails closed; simulated RPC never inserts confirmation records',
  )
  for (const url of [
    'https://api.example.com/data',
    'https://localhost/data',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://[::1]',
    'https://2130706433',
    'https://metadata.google.internal',
    'https://rebinding.example.com',
  ])
    assert.equal((await invoke('upstream', url)).status, 503)
  pass(
    'production transport denies every destination including allowlisted-looking names, private targets and DNS rebinding candidates; no DNS or fetch is attempted',
  )
  const account = privateKeyToAccount(generatePrivateKey()) // Unfunded ephemeral local signing only; never output/persisted.
  const addr = '0x00000000000000000000000000000000000a11ce',
    asset = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
  const required = {
    scheme: 'exact',
    network: 'eip155:8453',
    asset,
    amount: '1000',
    payTo: addr,
    maxTimeoutSeconds: 60,
    extra: {
      name: 'USD Coin',
      version: '2',
      paymentFlow: 'upfront',
      assetTransferMethod: 'eip3009',
    },
  }
  const now = Math.floor(Date.now() / 1000),
    authorization = {
      from: account.address,
      to: addr,
      value: '1000',
      validAfter: String(now - 10),
      validBefore: String(now + 60),
      nonce: '0x' + '66'.repeat(32),
    }
  const signature = await account.signTypedData({
    domain: {
      name: 'USD Coin',
      version: '2',
      chainId: 8453,
      verifyingContract: asset,
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
      ...authorization,
      value: 1000n,
      validAfter: BigInt(authorization.validAfter),
      validBefore: BigInt(authorization.validBefore),
    },
  })
  const header = encodePaymentSignatureHeader({
    x402Version: 2,
    accepted: required,
    resource: {
      url: 'http://127.0.0.1/sg07/local-only',
      description: 'LOCAL SIMULATION ONLY — do not pay',
      mimeType: 'application/json',
    },
    payload: { authorization, signature },
  })
  for (const mode of ['invalid-verification', 'wrong-token']) {
    const r = await invoke('facilitator', mode, {
      header,
      payer: account.address,
    })
    assert.equal(r.status, 402)
    assert.equal(r.body.settleCalls, 0)
    pass('facilitator boundary rejects ' + mode + ' before settlement')
  }
  const paid = await invoke('facilitator', 'ok', {
    header,
    payer: account.address,
  })
  assert.equal(paid.status, 200)
  assert.equal(paid.body.verifyCalls, 1)
  assert.equal(paid.body.settleCalls, 1)
  assert.equal(paid.body.state.state, 'settlement_pending')
  assert.equal(
    paid.body.values.filter((x) => x.disposition === 'reported_settled').length,
    1,
  )
  assert.equal(paid.body.values.filter((x) => x.rejected).length, 1)
  pass(
    'SDK-typed facilitator adapter consumes one verification permit and actual D1 pending CAS under concurrent submission; facilitator report cannot create a receipt or content',
  )
  const unknown = await invoke('facilitator', 'ambiguous', {
    header,
    payer: account.address,
  })
  assert.equal(unknown.body.settleCalls, 1)
  assert.equal(unknown.body.state.state, 'settlement_pending')
  assert.equal(
    unknown.body.values.filter((x) => x.disposition === 'settlement_unknown')
      .length,
    1,
  )
  pass(
    'lost settlement response is unknown with no resubmission or fabricated receipt; durable orchestration remains SG05-owned',
  )
  for (const mode of ['wrong-settlement-network', 'wrong-settlement-amount']) {
    const rejected = await invoke('facilitator', mode, {
      header,
      payer: account.address,
    })
    assert.equal(rejected.body.settleCalls, 1)
    assert.equal(
      rejected.body.values.filter((x) => x.disposition === 'settlement_unknown')
        .length,
      1,
    )
    pass(
      'conflicting facilitator ' +
        mode +
        ' stays unknown without receipt or fulfillment',
    )
  }
  const persisted = await runtime.control('snapshot')
  assert.equal(persisted.attempts, 0)
  assert.equal(persisted.receipts, 0)
  pass(
    'actual D1 payment tables remain empty after all readiness probes; no simulated report is admitted as payment evidence',
  )
  // Compiler ABI has one tuple output, in exact storage-member order/type.
  const abi = JSON.parse(
    execFileSync('forge', ['inspect', 'EndpointRegistry', 'abi', '--json'], {
      cwd: join(root, 'contracts'),
      encoding: 'utf8',
    }),
  )
  const getter = abi.find((x) => x.name === 'getResource')
  assert.deepEqual(
    getter.inputs.map((c) => c.type),
    ['bytes32'],
  )
  assert.deepEqual(
    getter.outputs[0].components.map((c) => [c.name, c.type]),
    [
      ['owner', 'address'],
      ['version', 'uint64'],
      ['enabled', 'bool'],
      ['payout', 'address'],
      ['priceAtomic', 'uint96'],
      ['configHash', 'bytes32'],
      ['pendingOwner', 'address'],
    ],
  )
  assert.equal(abi.find((x) => x.name === 'CHAIN_ID').stateMutability, 'view')
  pass(
    'actual pinned Solidity compiler ABI matches registry read adapter; no deployment/signing operation is present',
  )
  const meta = join(root, '.wrangler/sg07-production-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/sg07-production-build'),
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
    inputs.some((x) =>
      /tests\/|server\/sg05\/|server\/sg07\/|@x402|@coinbase|zod/.test(x),
    ),
    false,
  )
  for (const path of [
    '/api/pay/x',
    '/api/sg07/registry',
    '/api/sg07/facilitator',
  ]) {
    const r = await fetch(runtime.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', SG07_LOCAL_ONLY: 'yes' },
      body: '{}',
    })
    assert.equal(r.status, 404)
    assert.equal(r.headers.get('PAYMENT-RESPONSE'), null)
    await r.arrayBuffer()
  }
  pass(
    'production Functions exclude readiness adapters, fixtures and payment SDK/Zod parsing; forged local flags cannot activate paid routes',
  )
  console.log(
    `${count} SG-07 checks passed in local Pages/workerd, D1 and compiler ABI inspection; no live RPC/CDP calls.`,
  )
} finally {
  await runtime.close()
}
