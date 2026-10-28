import assert from 'node:assert/strict'
import { spawn, spawnSync } from 'node:child_process'
import { createServer } from 'node:http'
import { mkdtemp, mkdir, writeFile, readFile, readdir, copyFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { gzipSync } from 'node:zlib'

const root = resolve(import.meta.dirname, '../..')
const wrangler = join(root, 'node_modules/wrangler/bin/wrangler.js')
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'))
const temp = await mkdtemp(join(root, '.wrangler/sg02a-'))
const children = []
const calls = []
let mockMode = 'reject'
const mock = createServer(async (req, res) => {
  let raw = ''
  for await (const chunk of req) raw += chunk
  const body = raw ? JSON.parse(raw) : undefined
  calls.push({ method: req.method, path: req.url, body })
  res.setHeader('Content-Type', 'application/json')
  if (req.url === '/supported' && req.method === 'GET') {
    res.end(JSON.stringify({ kinds: [{ x402Version: 2, scheme: 'exact', network: 'eip155:8453' }], extensions: [], signers: {} }))
  } else if (req.url === '/verify' && req.method === 'POST') {
    res.end(JSON.stringify(mockMode === 'verify-valid' ? { isValid: true } : { isValid: false, invalidReason: 'local_mock_rejection' }))
  } else if (req.url === '/settle' && req.method === 'POST') {
    res.end(JSON.stringify({ success: false, errorReason: 'local_mock_rejection', transaction: '', network: 'eip155:8453' }))
  } else {
    res.writeHead(404).end()
  }
})
async function listen(server) {
  await new Promise((done, reject) => { server.once('error', reject); server.listen(0, '127.0.0.1', done) })
  return server.address().port
}
async function freePort() {
  const server = createServer()
  const port = await listen(server)
  await new Promise(done => server.close(done))
  return port
}
async function start(cwd, assets, extra = []) {
  const port = await freePort()
  const inspectorPort = await freePort()
  let output = ''
  const child = spawn(process.execPath, [wrangler, 'pages', 'dev', assets, '--ip', '127.0.0.1', '--port', String(port), '--inspector-port', String(inspectorPort), ...extra], {
    cwd, stdio: ['ignore', 'pipe', 'pipe'], detached: true,
    env: { ...process.env, WRANGLER_SEND_METRICS: 'false', CI: 'true' },
  })
  children.push(child)
  child.runtimeOutput = () => output
  child.stdout.on('data', data => { output += data })
  child.stderr.on('data', data => { output += data })
  const base = `http://127.0.0.1:${port}`
  for (let attempt = 0; attempt < 200; attempt++) {
    if (child.exitCode !== null) throw new Error(output)
    try {
      const response = await fetch(`${base}/api/health`)
      if (response.status === 200) return base
    } catch { /* Wait for workerd to listen. */ }
    await delay(100)
  }
  throw new Error(`Runtime startup timed out: ${output}`)
}
let passed = 0
function pass(name) { passed++; console.log(`PASS ${name}`) }
async function health(base) {
  const response = await fetch(`${base}/api/health`)
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.deepEqual(await response.json(), { status: 'ok', service: 'SignalArc Gate', network: 'base-mainnet', chainId: 8453 })
}
try {
  const mockPort = await listen(mock)
  const fixture = join(temp, 'fixture')
  await mkdir(join(fixture, 'functions/api'), { recursive: true })
  await mkdir(join(fixture, 'assets'))
  await writeFile(join(fixture, 'wrangler.jsonc'), JSON.stringify({ name: 'sg02a-local-fixture', pages_build_output_dir: './assets', compatibility_date: config.compatibility_date, ...(config.compatibility_flags ? { compatibility_flags: config.compatibility_flags } : {}) }))
  await copyFile(join(root, 'functions/api/health.ts'), join(fixture, 'functions/api/health.ts'))
  await writeFile(join(fixture, 'functions/[[path]].ts'), `
import { handleCompatibility } from ${JSON.stringify(join(root, 'tests/compatibility/handler.ts'))}
export async function onRequest({ request, env }) {
  if (new URL(request.url).pathname === '/guards') {
    const missing = await handleCompatibility(request, {})
    const deployed = await handleCompatibility(request, { ...env, CF_PAGES_URL: 'https://example.pages.dev' })
    const publicHost = await handleCompatibility(new Request('https://example.invalid/challenge'), env)
    const nonlocalMock = await handleCompatibility(request, { ...env, MOCK_ORIGIN: 'https://example.invalid' })
    return Response.json([missing.status, deployed.status, publicHost.status, nonlocalMock.status])
  }
  return handleCompatibility(request, env)
}
`)
  // The former expected-failure probe must now build AND execute successfully.
  const probe = join(temp, 'cdp-functions')
  await mkdir(probe)
  const probeSource = `
import { createCdpFacilitatorClient } from '@coinbase/cdp-sdk/x402'
import { handleCompatibility } from ${JSON.stringify(join(root, 'tests/compatibility/handler.ts'))}
export async function onRequest({ request, env }) {
  const guarded = await handleCompatibility(new Request(new URL('/modules', request.url), request), env)
  if (!guarded.ok) return guarded
  const body = await guarded.json()
  return Response.json({ ...body, available: typeof createCdpFacilitatorClient === 'function' })
}
`
  await writeFile(join(probe, 'probe.ts'), probeSource)
  await writeFile(join(fixture, 'functions/probe.ts'), probeSource)
  const built = spawnSync(process.execPath, [wrangler, 'pages', 'functions', 'build', probe, '--outdir', join(temp, 'cdp-build'), '--compatibility-date', config.compatibility_date], {
    cwd: root, encoding: 'utf8', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
  })
  assert.equal(built.status, 0, `CDP public entry-point bundle FAILED:\n${built.stdout}${built.stderr}`)
  for (const file of await readdir(join(temp, 'cdp-build'), { recursive: true })) {
    if (file.endsWith('.js') || file.endsWith('.mjs')) {
      const bytes = await readFile(join(temp, 'cdp-build', file))
      console.log(`CDP probe bundle ${file}: ${bytes.length} bytes; gzip ${gzipSync(bytes).length} bytes`)
    }
  }
  pass('formerly blocked CDP public entry-point Pages bundle succeeds')
  const base = await start(fixture, 'assets', ['--binding', 'SG02A_LOCAL_ONLY=yes', '--binding', 'CF_PAGES_URL=http://127.0.0.1', '--binding', `MOCK_ORIGIN=http://127.0.0.1:${mockPort}`])
  await health(base); pass('health in SDK-loaded Pages project')
  const modules = await (await fetch(`${base}/modules`)).json()
  const expectedModules = { localOnly: true, credentialGuard: true, webCryptoBytes: 32,
    cdpHelperAvailable: true, cdpCredentialGuard: true, networks: ['eip155:8453'] }
  assert.deepEqual(modules, expectedModules)
  pass('Foundation/EVM/CDP auth modules execute; credential guard and Web Crypto work')
  const cdpProbe = await fetch(`${base}/probe`)
  assert.equal(cdpProbe.status, 200)
  assert.deepEqual(await cdpProbe.json(), { ...expectedModules, available: true })
  pass('formerly blocked CDP probe loads and invokes helper credential guard in Pages/workerd')
  assert.deepEqual(await (await fetch(`${base}/guards`)).json(), [404, 404, 404, 503])
  pass('missing binding, deployed environment, public hostname, external mock blocked')
  assert.deepEqual(await (await fetch(`${base}/egress`)).json(), { localOnly: true, blocked: true })
  assert.equal(calls.length, 0)
  pass('test-only egress interception blocks non-mock target before fetch')
  const response = await fetch(`${base}/challenge`)
  assert.equal(response.status, 402)
  const challenge = JSON.parse(Buffer.from(response.headers.get('payment-required'), 'base64').toString())
  assert.equal(challenge.x402Version, 2)
  assert.equal(challenge.accepts.length, 1)
  assert.equal(challenge.accepts[0].network, 'eip155:8453')
  assert.equal(challenge.accepts[0].asset.toLowerCase(), '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  assert.equal(challenge.accepts[0].amount, '1000')
  assert.equal(calls.filter(c => c.path !== '/supported').length, 0)
  pass('missing authorization produces SDK-generated Base Mainnet USDC v2 402; no verify/settle')
  async function denied(header, path = '/challenge') {
    const r = await fetch(`${base}${path}`, { headers: { 'PAYMENT-SIGNATURE': header } })
    assert.equal(r.status, 402)
    assert.equal(r.headers.get('payment-response'), null)
    const body = await r.json()
    assert.equal(body.localOnly, true)
    return body
  }
  const encode = value => Buffer.from(JSON.stringify(value)).toString('base64')
  // Protocol envelope only: no signature or authorization, never a payable payload.
  const payload = { x402Version: 2, accepted: challenge.accepts[0], payload: { localOnly: true } }
  await denied('!invalid-base64!')
  await denied(encode({}))
  await denied(encode({ ...payload, accepted: { ...payload.accepted, amount: '999999' } }))
  await denied(encode({ ...payload, accepted: { ...payload.accepted, network: 'invalid:network' } }))
  await denied(encode({ ...payload, accepted: { ...payload.accepted, payTo: '0x0000000000000000000000000000000000000000' } }))
  assert.equal(calls.filter(c => c.path !== '/supported').length, 0)
  pass('malformed and mismatched authorization rejected before facilitator')
  const callsBeforeLimits = calls.length
  for (const oversized of [
    'a'.repeat(8193),
    encode({ ...payload, payload: { items: Array(33).fill(0) } }),
    Buffer.from('['.repeat(17) + '0' + ']'.repeat(17)).toString('base64'),
    encode({ ...payload, payload: Object.fromEntries(Array.from({ length: 33 }, (_, i) => [`k${i}`, 0])) }),
    encode({ ...payload, payload: { text: 'a'.repeat(2049) } }),
    encode({ ...payload, payload: { items: Array.from({ length: 9 }, () => Array(32).fill(0)) } }),
  ]) {
    const limited = await fetch(`${base}/challenge`, { headers: { 'PAYMENT-SIGNATURE': oversized } })
    assert.equal(limited.status, 413)
    assert.equal(limited.headers.get('payment-response'), null)
  }
  assert.equal((await fetch(`${base}/challenge`, { method: 'POST', body: '{}' })).status, 405)
  assert.equal((await fetch(`${base}/challenge?q=${'a'.repeat(2048)}`)).status, 414)
  assert.equal(calls.length, callsBeforeLimits)
  pass('header, nesting, collection, string, total-node, method and URL limits reject before SDK/facilitator')
  await denied(encode(payload))
  assert.equal(calls.filter(c => c.path === '/verify').length, 1)
  assert.equal(calls.filter(c => c.path === '/settle').length, 0)
  pass('mock verification rejection denies content without settlement')
  mockMode = 'verify-valid'
  assert.equal((await denied(encode(payload))).error, 'local_mock_cannot_authorize')
  assert.equal(calls.filter(c => c.path === '/verify').length, 2)
  assert.equal(calls.filter(c => c.path === '/settle').length, 0)
  pass('positive mock verification still cannot authorize content')
  assert.equal((await denied(encode(payload), '/settle-rejection')).error, 'mock_rejected')
  assert.equal(calls.filter(c => c.path === '/settle').length, 1)
  for (const call of calls.filter(c => c.body)) {
    assert.equal(call.body.paymentRequirements.network, 'eip155:8453')
    assert.equal(call.body.x402Version, 2)
  }
  pass('SDK settlement HTTP transport executes against rejection-only loopback mock')
  const production = await start(root, 'dist')
  await health(production); pass('unchanged production /api/health HTTP 200')
  const absent = await fetch(`${production}/challenge`)
  assert.equal(absent.headers.get('payment-required'), null)
  assert.equal((await absent.text()).includes('local_mock'), false)
  const absentProbe = await fetch(`${production}/probe`)
  assert.equal(absentProbe.headers.get('payment-required'), null)
  assert.equal((await absentProbe.text()).includes('cdpHelperAvailable'), false)
  pass('production Pages project exposes no compatibility fixture')
  console.log(`${passed} checks passed in local Wrangler Pages/workerd; mock calls: ${JSON.stringify(calls.map(c => ({ method: c.method, path: c.path })))}`)
} catch (error) {
  for (const child of children) console.error(child.runtimeOutput())
  throw error
} finally {
  for (const child of children) {
    if (child.exitCode === null) {
      process.kill(-child.pid, 'SIGTERM')
      await Promise.race([new Promise(done => child.once('exit', done)), delay(3000)])
    }
  }
  await new Promise(done => mock.close(done))
  await rm(temp, { recursive: true, force: true })
}
