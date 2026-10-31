import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { readFile, mkdir } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'
import { privateKeyToAccount, generatePrivateKey } from 'viem/accounts'
import { chromium } from 'playwright'
import { localRuntime } from '../../scripts/local-runtime.mjs'
// Unfunded local keys exist only in Node memory; they never reach the browser or logs.
const aliceAccount = privateKeyToAccount(generatePrivateKey()),
  bobAccount = privateKeyToAccount(generatePrivateKey())
const root = resolve(import.meta.dirname, '../..')
const historical = await Promise.all(
  ['0001_sg03.sql', '0002_sg05.sql'].map(async (name) => [
    name,
    createHash('sha256')
      .update(await readFile(join(root, 'migrations', name)))
      .digest('hex'),
  ]),
)
const runtime = await localRuntime({
  includeApp: true,
  controls: true,
  fixture: {
    prefix: 'sg06',
    module: join(root, 'tests/sg06/handler.ts'),
    bindings: { SG06_LOCAL_ONLY: 'yes' },
  },
})
let browser,
  passed = 0
const pass = (message) => {
  passed++
  console.log(`PASS ${message}`)
}
class Client {
  cookies = new Map()
  async request(path, method = 'GET', data, overrides = {}) {
    const headers = {
      Cookie: [...this.cookies].map(([k, v]) => `${k}=${v}`).join('; '),
      ...(method === 'GET'
        ? {}
        : {
            Origin: runtime.origin,
            'Content-Type': 'application/json',
            'X-SignalArc-Request': '1',
          }),
      ...overrides,
    }
    const r = await fetch(runtime.origin + path, {
      method,
      headers,
      redirect: 'error',
      ...(method === 'GET'
        ? {}
        : {
            body: typeof data === 'string' ? data : JSON.stringify(data ?? {}),
          }),
    })
    for (const raw of r.headers.getSetCookie()) {
      const pair = raw.split(';')[0],
        index = pair.indexOf('=')
      if (raw.includes('Max-Age=0')) this.cookies.delete(pair.slice(0, index))
      else this.cookies.set(pair.slice(0, index), pair.slice(index + 1))
    }
    const body = await r.json()
    return { r, body }
  }
}
async function expect(client, path, status, method = 'GET', body, headers) {
  const result = await client.request(path, method, body, headers)
  assert.equal(
    result.r.status,
    status,
    `${method} ${path} HTTP ${result.r.status}: ${result.body.error ?? ''}`,
  )
  assert.equal(result.r.headers.get('cache-control'), 'no-store')
  return result
}
async function login(client, account) {
  const { body } = await expect(client, '/api/auth/nonce', 200, 'POST', {
    address: account.address,
    chainId: 8453,
  })
  await expect(client, '/api/auth/verify', 200, 'POST', {
    message: body.message,
    signature: await account.signMessage({ message: body.message }),
  })
}
async function control(action, fields = {}) {
  const r = await fetch(runtime.origin + '/sg06/control', {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'Content-Type': 'application/json',
      'X-Local-Only': 'yes',
    },
    body: JSON.stringify({ action, ...fields }),
  })
  assert.equal(r.status, 200)
  return r.json()
}
const base = '/api/reporting/'
const alice = new Client(),
  bob = new Client(),
  anonymous = new Client()
async function create(client, name, payout) {
  return (
    await expect(client, '/api/resources', 201, 'POST', {
      name,
      upstreamUrl:
        'https://api.example.com/private-' +
        name.toLowerCase().replaceAll(' ', '-'),
      priceAtomic: '1000',
      payoutAddress: payout,
      responseConfig: { type: 'json', maxBytes: 4096, redirects: 'error' },
      network: 'eip155:8453',
      enabled: true,
    })
  ).body.resource
}
try {
  assert.deepEqual((await runtime.control('migrate')).applied, [
    '0001_sg03.sql',
    '0002_sg05.sql',
    '0003_sg06_reporting_indexes.sql',
  ])
  assert.deepEqual((await runtime.control('migrate')).applied, [])
  for (const [name, digest] of historical)
    assert.equal(
      createHash('sha256')
        .update(await readFile(join(root, 'migrations', name)))
        .digest('hex'),
      digest,
    )
  pass(
    'real local D1 applies index-only forward migration idempotently; SG03/SG05 migration checksums remain unchanged',
  )
  for (const path of ['summary', 'attempts', 'receipts'])
    await expect(anonymous, base + path, 401)
  await login(alice, aliceAccount)
  await login(bob, bobAccount)
  const empty = (await expect(alice, base + 'summary', 200)).body
  assert.equal(empty.attempts.total, 0)
  assert.equal(empty.receipts.localSimulationAmountAtomic, '0')
  assert.equal(empty.verified.available, false)
  assert.equal(empty.verified.amountAtomic, null)
  pass(
    'authenticated empty reporting is real D1 data; missing/invalid sessions cannot read it and Mainnet verification is explicitly unavailable',
  )
  const a = await create(alice, 'Alice API', aliceAccount.address),
    b = await create(bob, 'Bob API', bobAccount.address)
  await control('seed', { resourceId: a.id })
  await control('seed', { resourceId: b.id })
  const summary = (await expect(alice, base + 'summary', 200)).body
  assert.equal(summary.attempts.total, 8)
  assert.equal(summary.attempts.localSimulation, 7)
  assert.equal(summary.attempts.unverified, 1)
  assert.equal(summary.receipts.localSimulation, 2)
  assert.equal(summary.receipts.unverified, 1)
  assert.equal(summary.receipts.localSimulationAmountAtomic, '1000000000000')
  assert.equal(summary.attempts.byPhase.settlement_unknown, 1)
  assert.equal(summary.attempts.byPhase.settlement_pending, 1)
  assert.equal(summary.attempts.byPhase.fulfillment_failed, 1)
  assert.equal(summary.verified.settlements, null)
  pass(
    'D1 counts eight owned attempts and two consistent local receipts, sums atomic USDC exactly, and separates pending/unknown/legacy states from Mainnet metrics',
  )
  assert.equal(
    (await control('duplicate', { resourceId: a.id })).rejected,
    true,
  )
  assert.deepEqual((await expect(alice, base + 'summary', 200)).body, summary)
  pass(
    'actual D1 uniqueness rejects duplicate receipts; retries cannot inflate counts or atomic totals',
  )
  for (const path of ['summary', 'attempts', 'receipts'])
    await expect(bob, `${base}${path}?resourceId=${a.id}`, 404)
  const owned = (await expect(alice, base + 'attempts', 200)).body
  assert.equal(owned.items.length, 8)
  assert.equal(
    owned.items.every((v) => v.resourceId === a.id),
    true,
  )
  assert.equal(JSON.stringify(owned).includes('Bob API'), false)
  await expect(
    bob,
    `${base}attempts?merchantId=${(await expect(alice, '/api/auth/session', 200)).body.merchant.id}`,
    422,
  )
  pass(
    'every report enforces session merchant/resource ownership and rejects client merchant identity claims',
  )
  let cursor = '',
    ids = []
  do {
    const page = (
      await expect(
        alice,
        `${base}attempts?limit=2${cursor ? '&cursor=' + cursor : ''}`,
        200,
      )
    ).body
    ids.push(...page.items.map((i) => i.id))
    cursor = page.nextCursor ?? ''
  } while (cursor)
  assert.equal(ids.length, 8)
  assert.equal(new Set(ids).size, 8)
  const first = (await expect(alice, base + 'attempts?limit=2', 200)).body
  await expect(bob, base + 'attempts?limit=2&cursor=' + first.nextCursor, 422)
  await expect(
    alice,
    base + 'attempts?source=unverified&cursor=' + first.nextCursor,
    422,
  )
  pass(
    'bounded keyset pagination traverses tied timestamps without duplicates and binds cursors to merchant/filter scope',
  )
  const rr = (await expect(alice, base + 'receipts', 200)).body.items
  const legacy = rr.find((r) => r.provenance === 'unverified')
  assert.equal(legacy.amountAtomic, null)
  assert.equal(legacy.transactionReference, null)
  const serialized = JSON.stringify({ owned, rr, summary })
  for (const field of [
    'authorization_key',
    'authorization_fingerprint',
    'request_hash',
    'requirements_json',
    'settlement_json',
    'config_salt',
    'token_hash',
    'upstream_url',
  ])
    assert.equal(serialized.includes(field), false)
  assert.equal(serialized.includes('https://api.example.com'), false)
  for (const path of ['attempts', 'receipts'])
    assert.equal(
      (await expect(alice, `${base}${path}?source=verified`, 200)).body.items
        .length,
      0,
    )
  pass(
    'explicit projections redact authorization/session/upstream data and quarantine unverified receipts instead of manufacturing Mainnet proof',
  )
  assert.equal(
    (await expect(alice, base + 'attempts?phase=settlement_unknown', 200)).body
      .items.length,
    1,
  )
  assert.equal(
    (await expect(alice, base + 'attempts?source=local_simulation', 200)).body
      .items.length,
    7,
  )
  assert.equal(
    (await expect(alice, base + 'receipts?source=unverified', 200)).body.items
      .length,
    1,
  )
  for (const query of [
    'limit=0',
    'limit=51',
    'limit=1e2',
    'source=made-up',
    'phase=made-up',
    'resourceId=bad',
    'from=2026-02-30',
    'from=2020-01-01&to=2026-01-01',
    'from=2026-10-31&to=2026-10-01',
    'source=all&source=unverified',
    'cursor=bad',
    'from=not-a-date',
  ])
    await expect(alice, base + 'attempts?' + query, 422)
  const noRecords = (
    await expect(alice, base + 'summary?from=2020-01-01&to=2020-01-02', 200)
  ).body
  assert.equal(noRecords.attempts.total, 0)
  pass(
    'source, phase, calendar/date-window, cursor, limit and duplicate filters are validated; historical empty windows remain empty',
  )
  await expect(alice, base + 'summary', 405, 'POST', {})
  await expect(alice, base + 'summary', 403, 'GET', undefined, {
    'Sec-Fetch-Site': 'cross-site',
  })
  await expect(alice, base + 'attempts?x=' + 'x'.repeat(2100), 414)
  await expect(alice, '/api/resources', 413, 'POST', 'x'.repeat(16385))
  await expect(alice, base + 'summary', 413, 'GET', undefined, {
    'X-Large': 'x'.repeat(17000),
  })
  const noCors = await expect(alice, base + 'summary', 200)
  assert.equal(noCors.r.headers.get('access-control-allow-origin'), null)
  assert.equal(noCors.r.headers.get('referrer-policy'), 'no-referrer')
  assert.equal(noCors.r.headers.get('x-frame-options'), 'DENY')
  pass(
    'reporting is read-only, bounded, no-store and non-CORS; cross-site reads and oversized/malformed operations fail safely',
  )
  await control('fault', { mode: 'on' })
  const fail = await expect(alice, base + 'receipts', 503)
  assert.equal(/SELECT|SQLite|payment_receipts/i.test(fail.body.error), false)
  await control('restore')
  assert.equal(
    (await expect(alice, base + 'receipts', 200)).body.items.length,
    3,
  )
  pass(
    'actual missing-table D1 failure returns a sanitized error; restoration recovers real reporting data',
  )
  const stolen = new Client()
  stolen.cookies = new Map(alice.cookies)
  await runtime.control('expireSession', {
    token: alice.cookies.get('sg_session'),
  })
  await expect(alice, base + 'summary', 401)
  await login(alice, aliceAccount)
  const replay = new Client()
  replay.cookies = new Map(alice.cookies)
  await expect(alice, '/api/auth/logout', 200, 'POST', {})
  await expect(replay, base + 'receipts', 401)
  await expect(stolen, base + 'summary', 401)
  pass(
    'session expiry and logout invalidate report access even with old cookies replayed',
  )
  assert.equal(
    (await (await fetch(runtime.origin + '/sg06/egress')).json()).blocked,
    true,
  )
  pass(
    'isolated reporting fixture cannot make external RPC, facilitator or upstream requests',
  )

  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const external = []
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== runtime.origin) {
      external.push(true)
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage(),
    errors = []
  page.on('pageerror', (e) => errors.push(e.message))
  await page.exposeFunction('localSign', async (message, address) =>
    (address.toLowerCase() === aliceAccount.address.toLowerCase()
      ? aliceAccount
      : bobAccount
    ).signMessage({ message }),
  )
  await page.addInitScript(
    ({ alice, bob }) => {
      let address = alice,
        chain = '0x0',
        connected = false
      const listeners = new Map()
      const emit = (k, v) => {
        for (const fn of listeners.get(k) ?? []) fn(v)
      }
      window.switchLocalWallet = () => {
        address = bob
        emit('accountsChanged', [address])
      }
      window.ethereum = {
        on(k, fn) {
          listeners.set(k, [...(listeners.get(k) ?? []), fn])
          return this
        },
        removeListener(k, fn) {
          listeners.set(
            k,
            (listeners.get(k) ?? []).filter((f) => f !== fn),
          )
          return this
        },
        async request({ method, params }) {
          if (method === 'eth_requestAccounts') {
            connected = true
            return [address]
          }
          if (method === 'eth_accounts') return connected ? [address] : []
          if (method === 'eth_chainId') return chain
          if (method === 'wallet_switchEthereumChain') {
            if (params[0].chainId !== '0x2105') throw Error('Base only')
            chain = '0x2105'
            emit('chainChanged', chain)
            return null
          }
          if (method === 'wallet_requestPermissions') {
            connected = true
            return [{ parentCapability: 'eth_accounts' }]
          }
          if (method === 'wallet_getPermissions')
            return connected ? [{ parentCapability: 'eth_accounts' }] : []
          if (method === 'wallet_revokePermissions') {
            connected = false
            return null
          }
          if (method === 'personal_sign') {
            const bytes = new Uint8Array(
              params[0]
                .slice(2)
                .match(/.{2}/g)
                .map((x) => parseInt(x, 16)),
            )
            return window.localSign(new TextDecoder().decode(bytes), address)
          }
          throw Error('Unsupported local provider method')
        },
      }
    },
    { alice: aliceAccount.address, bob: bobAccount.address },
  )
  await page.goto(runtime.origin + '/manage')
  await page.getByText('No wallet connected.', { exact: true }).waitFor()
  assert.equal(
    await page
      .getByRole('heading', { name: 'Payment records and usage' })
      .count(),
    0,
  )
  await page.getByRole('button', { name: /^Connect / }).click()
  await page
    .getByText('Wrong network. Switch to Base Mainnet to sign in.', {
      exact: true,
    })
    .waitFor()
  assert.equal(
    await page
      .getByRole('button', { name: 'Sign in with Ethereum', exact: true })
      .isDisabled(),
    true,
  )
  await page
    .getByRole('button', { name: 'Switch to Base Mainnet', exact: true })
    .click()
  let releaseResources
  const holdResources = new Promise((r) => {
    releaseResources = r
  })
  await page.route('**/api/resources', async (route) => {
    if (route.request().method() === 'GET') {
      await holdResources
    }
    await route.continue()
  })
  await page
    .getByRole('button', { name: 'Sign in with Ethereum', exact: true })
    .click()
  await page.getByTestId('authenticated-wallet').waitFor()
  await page.getByText('Loading resources…', { exact: true }).waitFor()
  releaseResources()
  await page
    .getByRole('button', { name: 'Edit Alice API', exact: true })
    .waitFor()
  await page.unroute('**/api/resources')
  await page.getByText('1000000 simulated USDC', { exact: false }).waitFor()
  pass(
    'Chromium connects via injected test provider, blocks wrong chain, signs real local SIWE, and shows genuine loading and authenticated dashboard data',
  )
  assert.equal(
    await page.getByTestId('attempt-total').textContent(),
    '8 attempts',
  )
  assert.match(
    await page.getByTestId('simulation-total').textContent(),
    /2 local receipts · 1000000 simulated USDC/,
  )
  await page.getByText('Verification unavailable', { exact: true }).waitFor()
  assert.equal(await page.getByText('Bob API', { exact: true }).count(), 0)
  assert.equal(await page.locator('a[href*="basescan"]').count(), 0)
  pass(
    'dashboard separates local totals and uncertain delivery states, shows no fake verified revenue and creates no Mainnet explorer links for mock references',
  )
  await page
    .getByLabel('Record source', { exact: true })
    .selectOption('unverified')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page.waitForFunction(
    () =>
      document.querySelector('[data-testid="attempt-total"]')?.textContent ===
      '1 attempts',
  )
  await page.getByTestId('receipt-record').waitFor()
  assert.equal(await page.getByTestId('receipt-record').count(), 1)
  await page
    .getByText(
      'Amount and transaction reference withheld pending provenance review.',
      { exact: true },
    )
    .waitFor()
  await page
    .getByLabel('Record source', { exact: true })
    .selectOption('verified')
  await page.getByRole('button', { name: 'Apply filters', exact: true }).click()
  await page
    .getByText('No matching payment attempts.', { exact: true })
    .waitFor()
  pass(
    'browser source filters use authenticated backend results; unverified details are redacted and verified mode is honestly empty',
  )
  await page.route('**/api/reporting/summary?**', (route) =>
    route.fulfill({
      status: 503,
      contentType: 'application/json',
      body: JSON.stringify({ error: 'Local reporting outage' }),
    }),
  )
  await page
    .getByRole('button', { name: 'Refresh records', exact: true })
    .click()
  await page.getByText('Local reporting outage', { exact: true }).waitFor()
  await page.unroute('**/api/reporting/summary?**')
  await page
    .getByRole('button', { name: 'Retry reporting', exact: true })
    .click()
  await page
    .getByText('Local reporting outage', { exact: true })
    .waitFor({ state: 'detached' })
  pass(
    'dashboard presents a clear reporting error and retry recovers real server data',
  )
  for (const width of [390, 1280]) {
    await page.setViewportSize({ width, height: 900 })
    assert.equal(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= window.innerWidth,
      ),
      true,
    )
  }
  assert.equal(await page.locator('main').count(), 1)
  assert.equal(await page.locator('h1').count(), 1)
  assert.equal(
    await page
      .locator('input,select')
      .evaluateAll((nodes) => nodes.every((n) => n.labels?.length > 0)),
    true,
  )
  assert.equal(
    await page
      .getByRole('button')
      .evaluateAll((nodes) =>
        nodes.every(
          (n) =>
            (n.getAttribute('aria-label') ?? n.textContent).trim().length > 0,
        ),
      ),
    true,
  )
  await page.keyboard.press('Tab')
  assert.equal(
    await page.evaluate(() => document.activeElement !== document.body),
    true,
  )
  assert.equal(
    (await page.request.get(runtime.origin + '/manage')).headers()[
      'x-frame-options'
    ],
    'DENY',
  )
  await mkdir(join(root, '.wrangler'), { recursive: true })
  await page.screenshot({
    path: join(root, '.wrangler/sg06-desktop.png'),
    fullPage: true,
  })
  await page.setViewportSize({ width: 390, height: 844 })
  await page.screenshot({
    path: join(root, '.wrangler/sg06-mobile.png'),
    fullPage: true,
  })
  pass(
    'desktop/mobile fit the viewport with labelled controls, named buttons, keyboard focus and real static security headers',
  )
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await page.getByText('Not signed in.', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('attempt-record').count(), 0)
  await page.evaluate(() => window.switchLocalWallet())
  await page
    .getByRole('button', { name: 'Sign in with Ethereum', exact: true })
    .click()
  await page
    .getByTestId('authenticated-wallet')
    .filter({ hasText: bobAccount.address })
    .waitFor()
  await page.getByText('Bob API', { exact: true }).first().waitFor()
  assert.equal(await page.getByText('Alice API', { exact: true }).count(), 0)
  assert.equal(await page.evaluate(() => localStorage.length), 0)
  assert.equal(
    await page.evaluate(() => /sg_session|sg_challenge/.test(document.cookie)),
    false,
  )
  pass(
    'logout clears merchant reports and switching wallet/session loads only the new merchant; no JS-readable auth cookie or localStorage token',
  )
  await page.context().clearCookies()
  await page
    .getByRole('button', { name: 'Refresh records', exact: true })
    .click()
  await page.getByText('Not signed in.', { exact: true }).waitFor()
  assert.equal(await page.getByTestId('attempt-record').count(), 0)
  assert.deepEqual(errors, [])
  assert.deepEqual(external, [])
  pass(
    '401 reporting response clears authenticated UI/cache without leaking old records; no uncaught browser errors or external requests',
  )
  for (const path of [
    '/sg06/control',
    '/sg05/pay/' + a.id,
    '/api/pay/' + a.id,
  ]) {
    const response = await fetch(runtime.origin + path, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', SG05_LOCAL_ONLY: 'yes' },
      body: '{}',
    })
    assert.notEqual(response.status, 200)
    assert.equal(response.headers.get('payment-response'), null)
    await response.arrayBuffer()
  }
  const meta = join(root, '.wrangler/sg06-production-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/sg06-production-build'),
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
        p.includes('tests/') ||
        p.includes('server/sg05/') ||
        p.includes('@x402') ||
        p.includes('@coinbase'),
    ),
    false,
  )
  pass(
    'production Functions includes authenticated reporting but excludes local fixtures, SG05 gateway/payment SDKs and all public paid fulfillment',
  )
  console.log(
    `${passed} SG-06 checks passed in native Pages/workerd + real local D1 and Chromium. Payment records are labeled local test fixtures, never real Mainnet activity.`,
  )
} finally {
  await browser?.close()
  await runtime.close()
}
