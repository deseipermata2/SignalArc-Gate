import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  mkdir,
  mkdtemp,
  writeFile,
  copyFile,
  readFile,
  rm,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { chromium } from 'playwright'

const root = resolve(import.meta.dirname, '../..')
await mkdir(join(root, '.wrangler'), { recursive: true })
const temp = await mkdtemp(join(root, '.wrangler/sg02-foundation-'))
const config = JSON.parse(await readFile(join(root, 'wrangler.jsonc'), 'utf8'))
const processes = []
let browser
let passed = 0
const expectedHealth = {
  status: 'ok',
  service: 'SignalArc Gate',
  network: 'base-mainnet',
  chainId: 8453,
}
function pass(name) {
  passed++
  console.log(`PASS ${name}`)
}
async function freePort() {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const port = server.address().port
  await new Promise((done) => server.close(done))
  return port
}
async function start(cwd, assets, extra = []) {
  const port = await freePort()
  const inspectorPort = await freePort()
  let logs = ''
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'dev',
      assets,
      '--ip',
      '127.0.0.1',
      '--port',
      String(port),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      join(temp, `state-${port}`),
      ...extra,
    ],
    {
      cwd,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    },
  )
  processes.push({ child, logs: () => logs })
  child.stdout.on('data', (chunk) => {
    logs += chunk
  })
  child.stderr.on('data', (chunk) => {
    logs += chunk
  })
  const base = `http://127.0.0.1:${port}`
  for (let i = 0; i < 250; i++) {
    if (child.exitCode !== null) throw new Error(logs)
    try {
      if ((await fetch(`${base}/api/health`)).status === 200) return base
    } catch {
      /* workerd is starting */
    }
    await delay(100)
  }
  throw new Error(`Pages startup timed out: ${logs}`)
}

try {
  if (!process.argv.includes('--ui-only')) {
    const fixture = join(temp, 'fixture')
    await mkdir(join(fixture, 'functions/api'), { recursive: true })
    await mkdir(join(fixture, 'assets'))
    await writeFile(
      join(fixture, 'wrangler.jsonc'),
      JSON.stringify({
        name: 'signalarc-foundation-local',
        pages_build_output_dir: './assets',
        compatibility_date: config.compatibility_date,
      }),
    )
    await copyFile(
      join(root, 'functions/api/health.ts'),
      join(fixture, 'functions/api/health.ts'),
    )
    await writeFile(
      join(fixture, 'functions/[[path]].ts'),
      `
import { handleFoundation } from ${JSON.stringify(join(root, 'tests/foundation/handler.ts'))}
// Test-only worker egress is disabled; D1 uses its local native binding transport.
globalThis.fetch = async () => { throw new Error('Local foundation fixture egress disabled') }
export async function onRequest({ request, env }) {
  if (new URL(request.url).pathname === '/guard-check') {
    const missing = await handleFoundation(request, { ...env, SG02_LOCAL_ONLY: undefined })
    const publicHost = await handleFoundation(new Request('https://example.invalid/d1-smoke'), env)
    const publicEnv = await handleFoundation(request, { ...env, CF_PAGES_URL: 'https://example.pages.dev' })
    const write = new Request(new URL('/d1-probe/create', request.url), { method: 'POST' })
    const missingWrite = await handleFoundation(write, { ...env, SG02_LOCAL_ONLY: undefined })
    const publicWrite = await handleFoundation(new Request('https://example.invalid/d1-probe/create', { method: 'POST' }), env)
    const deployedWrite = await handleFoundation(write, { ...env, CF_PAGES_URL: 'https://example.pages.dev' })
    return Response.json([missing.status, publicHost.status, publicEnv.status, missingWrite.status, publicWrite.status, deployedWrite.status])
  }
  if (new URL(request.url).pathname === '/egress-check') {
    try { await fetch('https://example.invalid/'); return Response.json({ blocked: false }) }
    catch { return Response.json({ blocked: true }) }
  }
  if (new URL(request.url).pathname === '/missing-binding') {
    return handleFoundation(request, { ...env, SIGNALARC_DB: undefined })
  }
  return handleFoundation(request, env)
}
`,
    )
    const base = await start(fixture, 'assets', [
      '--d1',
      'SIGNALARC_DB',
      '--binding',
      'BASE_CHAIN_ID=8453',
      '--binding',
      'SG02_LOCAL_ONLY=yes',
      '--binding',
      'CF_PAGES_URL=http://127.0.0.1',
    ])
    const sql = await fetch(`${base}/d1-smoke`)
    const sqlBody = await sql.text()
    assert.equal(sql.status, 200, sqlBody)
    const row = JSON.parse(sqlBody)
    assert.equal(row.localOnly, true)
    assert.equal(row.chainId, 8453)
    assert.equal(row.network, 'eip155:8453')
    assert.equal(row.calculation, 42)
    console.log(`Local D1 SQL result: ${JSON.stringify(row)}`)
    pass(
      'native Pages Function accesses real local D1, binds parameters and executes SQLite SQL',
    )
    async function probe(action, method = 'GET') {
      const response = await fetch(`${base}/d1-probe/${action}`, {
        method,
        redirect: 'error',
      })
      const text = await response.text()
      assert.equal(response.status, 200, `${action}: ${text}`)
      assert.equal(response.headers.get('cache-control'), 'no-store')
      const result = JSON.parse(text)
      assert.equal(result.localOnly, true)
      assert.equal(result.servedBy, 'miniflare.db')
      return result
    }
    const initial = await probe('state')
    assert.equal(initial.tableExists, false)
    assert.deepEqual(initial.rows, [])
    pass('fresh isolated D1 database contains no write-probe table')
    try {
      const created = await probe('create', 'POST')
      assert.equal(created.tableExists, true)
      assert.deepEqual(created.rows, [])
      const inserted = await probe('insert', 'POST')
      assert.equal(inserted.changes, 1)
      const persisted = await probe('state')
      const expected = {
        id: 'sg02-local-record',
        marker: 'inserted',
        chainId: 8453,
        revision: 1,
      }
      assert.equal(persisted.tableExists, true)
      assert.deepEqual(persisted.rows, [expected])
      console.log(
        `Local D1 persisted INSERT/SELECT: ${JSON.stringify(persisted)}`,
      )
      pass(
        'CREATE and bound INSERT persist exact record across separate Pages requests',
      )
      const updated = await probe('update', 'POST')
      assert.equal(updated.changes, 1)
      const afterUpdate = await probe('state')
      assert.deepEqual(afterUpdate.rows, [
        { ...expected, marker: 'updated', revision: 2 },
      ])
      console.log(
        `Local D1 persisted UPDATE/SELECT: ${JSON.stringify(afterUpdate)}`,
      )
      pass(
        'bound UPDATE persists exact changed record across separate Pages requests',
      )
      const deleted = await probe('delete', 'POST')
      assert.equal(deleted.changes, 1)
      const afterDelete = await probe('state')
      assert.equal(afterDelete.tableExists, true)
      assert.deepEqual(afterDelete.rows, [])
      console.log(`Local D1 DELETE/SELECT: ${JSON.stringify(afterDelete)}`)
      pass(
        'bound DELETE removes the record and a separate SELECT verifies empty state',
      )
    } finally {
      const cleanup = await probe('cleanup', 'POST')
      assert.equal(cleanup.tableExists, false)
      const afterCleanup = await probe('state')
      assert.equal(afterCleanup.tableExists, false)
      assert.deepEqual(afterCleanup.rows, [])
      console.log(`Local D1 DROP/inspection: ${JSON.stringify(afterCleanup)}`)
      pass(
        'finally cleanup drops test table and a separate metadata query proves absence',
      )
    }
    assert.deepEqual(await (await fetch(`${base}/egress-check`)).json(), {
      blocked: true,
    })
    assert.equal((await fetch(`${base}/d1-probe/create`)).status, 405)
    assert.equal(
      (await fetch(`${base}/d1-probe/state`, { method: 'POST' })).status,
      405,
    )
    pass(
      'write actions require POST and fixture blocks public network fetch before transport',
    )
    const validation = await (await fetch(`${base}/configuration`)).json()
    assert.deepEqual(validation.errors, [
      'Missing required configuration: BASE_CHAIN_ID',
      'BASE_CHAIN_ID must be 8453 (Base Mainnet)',
      'Missing or invalid D1 binding: SIGNALARC_DB',
      'Missing or invalid D1 binding: SIGNALARC_DB',
    ])
    assert.equal(
      JSON.stringify(validation).includes('invalid-configuration-value'),
      false,
    )
    pass(
      'missing/invalid configuration fails clearly without echoing configuration values',
    )
    const missing = await fetch(`${base}/missing-binding`)
    assert.equal(missing.status, 503)
    assert.deepEqual(await missing.json(), {
      error: 'Missing or invalid D1 binding: SIGNALARC_DB',
    })
    pass('D1 consumer fails closed without binding')
    assert.deepEqual(
      await (await fetch(`${base}/guard-check`)).json(),
      [404, 404, 404, 404, 404, 404],
    )
    assert.equal(
      (await fetch(`${base}/d1-smoke`, { method: 'POST' })).status,
      405,
    )
    pass(
      'D1 fixture rejects unsafe read/write contexts and preserves GET-only smoke route',
    )
  }

  if (!process.argv.includes('--d1-only')) {
    const base = await start(root, 'dist', ['--d1', 'SIGNALARC_DB'])
    const health = await fetch(`${base}/api/health`)
    assert.equal(health.status, 200)
    assert.equal(health.headers.get('cache-control'), 'no-store')
    assert.deepEqual(await health.json(), expectedHealth)
    pass('normal Pages app retains exact health response')
    for (const path of [
      '/d1-smoke',
      '/configuration',
      '/d1-probe/state',
      '/probe',
      '/challenge',
    ]) {
      const response = await fetch(`${base}${path}`)
      assert.equal(response.headers.get('payment-required'), null)
      const text = await response.text()
      assert.equal(text.includes('localOnly'), false)
      assert.equal(text.includes('cdpHelperAvailable'), false)
      assert.equal(text.includes('calculation'), false)
      assert.equal(text.includes('tableExists'), false)
    }
    const publicWrite = await fetch(`${base}/d1-probe/create`, {
      method: 'POST',
    })
    assert.equal((await publicWrite.text()).includes('tableExists'), false)
    assert.equal(publicWrite.headers.get('payment-required'), null)
    pass('production route tree exposes no foundation or payment fixture')
    browser = await chromium.launch()
    const context = await browser.newContext({
      viewport: { width: 1280, height: 900 },
    })
    await context.route('**/*', (route) =>
      new URL(route.request().url()).origin === base
        ? route.continue()
        : route.abort(),
    )
    const page = await context.newPage()
    const pageErrors = []
    page.on('pageerror', (error) => pageErrors.push(error.message))
    await page.goto(base)
    await page.getByLabel('Actual health response').waitFor()
    assert.equal(await page.title(), 'SignalArc Gate')
    assert.equal(
      await page
        .getByRole('heading', { name: 'SignalArc Gate', exact: true })
        .count(),
      1,
    )
    assert.deepEqual(
      JSON.parse(await page.getByLabel('Actual health response').textContent()),
      expectedHealth,
    )
    assert.equal(await page.locator('[data-slot="card"]').count(), 1)
    assert.equal(
      await page
        .getByRole('button', { name: 'Check again' })
        .getAttribute('data-slot'),
      'button',
    )
    const style = await page
      .getByRole('button', { name: 'Check again' })
      .evaluate((el) => getComputedStyle(el).backgroundColor)
    assert.equal(style, 'rgb(25, 85, 232)')
    await page.screenshot({
      path: join(root, '.wrangler/sg02-desktop.png'),
      fullPage: true,
    })
    pass(
      'Chromium renders shadcn/ui and Tailwind styles with actual health data',
    )
    let release
    const gate = new Promise((done) => {
      release = done
    })
    await page.route('**/api/health', async (route) => {
      await gate
      await route.continue()
    })
    await page.reload()
    await page.getByRole('status').waitFor()
    assert.equal(
      await page.getByRole('button', { name: 'Checking…' }).isDisabled(),
      true,
    )
    release()
    await page.getByLabel('Actual health response').waitFor()
    await page.unroute('**/api/health')
    pass('frontend loading state is visible and prevents duplicate refresh')
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 503,
        contentType: 'application/json',
        body: '{}',
      }),
    )
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /HTTP 503/)
    await page.unroute('**/api/health')
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.getByLabel('Actual health response').waitFor()
    pass('frontend handles HTTP failure and retry recovers actual response')
    await page.route('**/api/health', (route) =>
      route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: '{"chainId":0}',
      }),
    )
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.getByRole('alert').waitFor()
    assert.match(await page.getByRole('alert').textContent(), /does not match/)
    await page.unroute('**/api/health')
    await page.getByRole('button', { name: 'Check again' }).click()
    await page.getByLabel('Actual health response').waitFor()
    pass('frontend rejects malformed/unexpected health contract')
    await page.setViewportSize({ width: 390, height: 844 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    )
    await page.screenshot({
      path: join(root, '.wrangler/sg02-mobile.png'),
      fullPage: true,
    })
    assert.deepEqual(pageErrors, [])
    pass('mobile layout fits viewport; no uncaught browser errors')
    await context.close()
  }
  console.log(
    `${passed} foundation checks passed; local SQL only, no remote credentials or services`,
  )
} catch (error) {
  await delay(200) // Allow Wrangler's diagnostic stream to flush on failure.
  for (const process of processes) console.error(process.logs())
  throw error
} finally {
  if (browser) await browser.close()
  for (const { child } of processes) {
    if (child.exitCode === null) {
      process.kill(-child.pid, 'SIGTERM')
      await Promise.race([
        new Promise((done) => child.once('exit', done)),
        delay(3000),
      ])
    }
  }
  await rm(temp, { recursive: true, force: true })
}
