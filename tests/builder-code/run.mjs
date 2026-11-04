import assert from 'node:assert/strict'
import { resolve } from 'node:path'
import { localRuntime } from '../../scripts/local-runtime.mjs'
const runtime = await localRuntime({
  includeApp: true,
  fixture: {
    prefix: 'builder-code',
    module: resolve('tests/builder-code/handler.ts'),
    bindings: { BUILDER_LOCAL_ONLY: 'yes' },
  },
})
let count = 0
const pass = (text) => {
  count++
  console.log('PASS ' + text)
}
try {
  const response = await fetch(runtime.origin + '/builder-code/probe')
  assert.equal(response.status, 200)
  const result = await response.json()
  assert.equal(result.code, 'bc_ipzfx50y')
  assert.deepEqual(result.echoPolicy, {
    exact: true,
    service: true,
    forgedWallet: false,
    wrongApp: false,
    oversizedServices: false,
  })
  assert.equal(result.declaration['builder-code'].info.a, result.code)
  assert.deepEqual(Object.keys(result.declaration['builder-code'].info), ['a'])
  pass(
    'owner code is declared as the application, never as the facilitator or another participant',
  )
  const vector =
    '0xa161616b62635f69707a6678353079000f0280218021802180218021802180218021'
  assert.equal(result.suffix, vector)
  assert.deepEqual(result.decoded, { a: 'bc_ipzfx50y' })
  pass(
    'official SDK Schema 2 encoding matches independent CBOR/length/schema/marker vector',
  )
  assert.equal(result.mockSenderSuffix, vector)
  assert.equal(result.payloadUnchanged, true)
  pass(
    'local SDK facilitator suffix construction does not mutate authorization, signature or payload; no payment is verified or settled',
  )
  assert.equal(result.wrongChainRejected, true)
  assert.equal(result.verifyCalls, 0)
  assert.equal(result.settleCalls, 0)
  assert.equal(result.blockedEgress, 0)
  assert.equal(result.productionEnabled, false)
  assert.equal(result.onchainAttributionVerified, false)
  pass(
    'Base-only configuration; zero signing, verification, settlement or outbound calls; no production attribution claim',
  )
  const challenge = await fetch(runtime.origin + '/builder-code/preview')
  assert.equal(challenge.status, 402)
  const body = await challenge.json()
  assert.deepEqual(
    body,
    JSON.parse(
      Buffer.from(challenge.headers.get('payment-required'), 'base64'),
    ),
  )
  assert.equal(body.extensions['builder-code'].info.a, result.code)
  assert.equal(body.accepts[0].network, 'eip155:8453')
  assert.equal(
    body.accepts[0].asset.toLowerCase(),
    '0x833589fcd6edb6e08f4c7c32d4f71b54bdA02913'.toLowerCase(),
  )
  assert.equal(challenge.headers.get('payment-response'), null)
  pass(
    'native local 402 format preview advertises the SDK declaration without settlement evidence',
  )
  const override = await fetch(
    runtime.origin + '/builder-code/probe?code=other',
  )
  assert.equal(override.status, 400)
  await override.arrayBuffer()
  pass('request data cannot override the server-owned code')
  const health = await fetch(runtime.origin + '/api/health')
  assert.equal(health.status, 200)
  assert.equal((await health.json()).chainId, 8453)
  pass('existing health behavior is preserved')
} finally {
  await runtime.close()
}
const ordinary = await localRuntime({ includeApp: true })
try {
  for (const path of [
    '/builder-code/probe',
    '/builder-code/preview',
    '/api/builder-code',
    '/api/pay',
  ]) {
    const response = await fetch(ordinary.origin + path, {
      headers: { 'X-Local-Only': 'yes', BUILDER_LOCAL_ONLY: 'yes' },
    })
    assert.notEqual(response.status, 402)
    assert.equal(response.headers.get('payment-required'), null)
    assert.equal(response.headers.get('payment-response'), null)
    assert.equal(response.headers.get('x-signalarc-mode'), null)
    const body = await response.text()
    assert.equal(body.includes('bc_ipzfx50y'), false)
  }
  pass(
    'ordinary production routing excludes all builder format fixtures and public paid responses',
  )
} finally {
  await ordinary.close()
}
console.log(
  count +
    ' Builder Code format/isolation checks passed. No signing or network settlement; hosted execution and onchain attribution remain unverified.',
)
