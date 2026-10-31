import assert from 'node:assert/strict'
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { parseSiweMessage } from 'viem/siwe'
import { chromium } from 'playwright'
import { localRuntime } from '../../scripts/local-runtime.mjs'

// Ephemeral local test keys stay only in this Node process. Never print or persist them.
const aliceAccount = privateKeyToAccount(generatePrivateKey())
const bobAccount = privateKeyToAccount(generatePrivateKey())
const runtime = await localRuntime({ includeApp: true, controls: true })
let browser
let passed = 0
function pass(name) {
  passed++
  console.log(`PASS ${name}`)
}
class Client {
  cookies = new Map()
  async request(path, method = 'GET', data, overrides = {}) {
    const headers = new Headers({
      Cookie: [...this.cookies]
        .map(([name, value]) => `${name}=${value}`)
        .join('; '),
      ...(method === 'GET'
        ? {}
        : {
            Origin: runtime.origin,
            'X-SignalArc-Request': '1',
            'Content-Type': 'application/json',
          }),
    })
    for (const [name, value] of Object.entries(overrides)) {
      if (value === null) headers.delete(name)
      else headers.set(name, value)
    }
    const response = await fetch(`${runtime.origin}${path}`, {
      method,
      redirect: 'error',
      headers,
      ...(method === 'GET'
        ? {}
        : {
            body: typeof data === 'string' ? data : JSON.stringify(data ?? {}),
          }),
    })
    for (const raw of response.headers.getSetCookie()) {
      const [pair] = raw.split(';'),
        split = pair.indexOf('=')
      if (raw.includes('Max-Age=0')) this.cookies.delete(pair.slice(0, split))
      else this.cookies.set(pair.slice(0, split), pair.slice(split + 1))
    }
    const body = await response.json()
    assert.equal(response.headers.get('cache-control'), 'no-store')
    return { response, body }
  }
}
async function expect(client, path, status, method = 'GET', data, headers) {
  const result = await client.request(path, method, data, headers)
  assert.equal(
    result.response.status,
    status,
    `${method} ${path}: ${result.body.error ?? 'unexpected status'}`,
  )
  return result
}
async function challenge(client, account) {
  const { body } = await expect(client, '/api/auth/nonce', 200, 'POST', {
    address: account.address,
    chainId: 8453,
  })
  return body.message
}
async function signed(account, message) {
  return { message, signature: await account.signMessage({ message }) }
}
async function login(client, account) {
  const message = await challenge(client, account)
  const result = await expect(
    client,
    '/api/auth/verify',
    200,
    'POST',
    await signed(account, message),
  )
  assert.deepEqual(Object.keys(result.body), ['authenticated'])
  assert.equal(result.body.authenticated === true, true)
  return result
}
const alice = new Client(),
  bob = new Client()
try {
  assert.deepEqual(await runtime.control('migrate'), {
    applied: [
      '0001_sg03.sql',
      '0002_sg05.sql',
      '0003_sg06_reporting_indexes.sql',
    ],
    localOnly: true,
  })
  assert.deepEqual(await runtime.control('migrate'), {
    applied: [],
    localOnly: true,
  })
  assert.deepEqual(await runtime.control('foreignKeyCheck'), { rejected: true })
  assert.deepEqual(await runtime.control('egress'), { blocked: true })
  pass(
    'real local D1 migration applies transactionally, is idempotent, enforces foreign keys and blocks external fetch',
  )
  const policy = await runtime.control('cookiePolicy')
  assert.match(policy.session, /^__Host-sg_session=/)
  assert.match(policy.challenge, /^__Host-sg_challenge=/)
  for (const value of [policy.session, policy.challenge]) {
    assert.match(value, /; Secure/)
    assert.match(value, /HttpOnly/)
    assert.match(value, /SameSite=Strict/)
    assert.match(value, /Path=\//)
    assert.doesNotMatch(value, /Domain=/)
  }
  assert.equal(policy.insecureRefused, true)
  pass(
    'HTTPS configuration uses Secure HttpOnly Strict __Host cookies and refuses public HTTP (local policy check, not a deployed HTTPS flow)',
  )
  await expect(alice, '/api/resources', 401)
  await expect(alice, '/api/auth/nonce', 422, 'POST', {
    address: aliceAccount.address,
    chainId: 0,
  })
  await expect(alice, '/api/auth/nonce', 422, 'POST', {
    address: 'invalid-wallet',
    chainId: 8453,
  })
  await expect(alice, '/api/auth/nonce', 422, 'POST', {
    address: '0x' + '0'.repeat(40),
    chainId: 8453,
  })
  await expect(
    alice,
    '/api/auth/nonce',
    403,
    'POST',
    { address: aliceAccount.address, chainId: 8453 },
    { Origin: 'https://attacker.invalid' },
  )
  await expect(
    alice,
    '/api/auth/nonce',
    403,
    'POST',
    { address: aliceAccount.address, chainId: 8453 },
    { Origin: null },
  )
  await expect(
    alice,
    '/api/auth/nonce',
    403,
    'POST',
    {},
    { 'X-SignalArc-Request': null },
  )
  pass(
    'nonce API rejects wrong chain, invalid wallets, cross-origin/missing-origin and missing CSRF header',
  )
  const message = await challenge(alice, aliceAccount)
  const noCookie = new Client()
  await expect(
    noCookie,
    '/api/auth/verify',
    401,
    'POST',
    await signed(aliceAccount, message),
  )
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(bobAccount, message),
  )
  await expect(alice, '/api/auth/verify', 422, 'POST', {
    message,
    signature: '0x' + '00'.repeat(100),
  })
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(
      aliceAccount,
      message.replace('Chain ID: 8453', 'Chain ID: 0'),
    ),
  )
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(
      aliceAccount,
      message.replace(new URL(runtime.origin).host, 'attacker.invalid'),
    ),
  )
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(
      aliceAccount,
      message.replace(
        `URI: ${runtime.origin}`,
        'URI: https://attacker.invalid',
      ),
    ),
  )
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(aliceAccount, message + '\nUnexpected: field'),
  )
  pass(
    'server cryptographically rejects invalid signer, unsupported contract signatures, wrong SIWE chain/domain/URI, missing cookie and malformed structure',
  )
  let expired = await challenge(alice, aliceAccount)
  await runtime.control('expireNonce', {
    nonce: parseSiweMessage(expired).nonce,
  })
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(aliceAccount, expired),
  )
  expired = await challenge(alice, aliceAccount)
  const expiredMessage = await runtime.control('expiredMessage', {
    nonce: parseSiweMessage(expired).nonce,
  })
  await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    await signed(aliceAccount, expiredMessage.message),
  )
  pass(
    'D1 nonce expiration and cryptographically signed expired SIWE messages are rejected',
  )
  const raceMessage = await challenge(alice, aliceAccount)
  const racePayload = await signed(aliceAccount, raceMessage)
  const raceBrowser = alice.cookies.get('sg_challenge')
  const beforeRace = await runtime.control('snapshot')
  const race = await Promise.all([
    alice.request('/api/auth/verify', 'POST', racePayload),
    alice.request('/api/auth/verify', 'POST', racePayload),
  ])
  assert.deepEqual(
    race.map((result) => result.response.status).sort(),
    [200, 401],
  )
  const afterRace = await runtime.control('snapshot')
  assert.equal(afterRace.sessions.length - beforeRace.sessions.length, 1)
  assert.equal(afterRace.merchants.length, 1)
  const success = race.find((result) => result.response.status === 200)
  const cookieHeader = success.response.headers
    .getSetCookie()
    .find((value) => value.startsWith('sg_session='))
  // Boolean assertions avoid printing a cookie/token even on a failed test.
  assert.equal(cookieHeader.includes('HttpOnly'), true)
  assert.equal(cookieHeader.includes('SameSite=Strict'), true)
  assert.equal(cookieHeader.includes('; Secure'), false)
  const token = alice.cookies.get('sg_session')
  assert.equal(/^[a-f0-9]{64}$/.test(token), true)
  assert.ok(
    afterRace.sessions.every(
      (row) =>
        /^[a-f0-9]{64}$/.test(row.token_hash) && row.token_hash !== token,
    ),
  )
  alice.cookies.set('sg_challenge', raceBrowser)
  const replay = await expect(
    alice,
    '/api/auth/verify',
    401,
    'POST',
    racePayload,
  )
  assert.match(replay.body.error, /already used/)
  alice.cookies.delete('sg_challenge')
  pass(
    'atomic nonce race produces exactly one session/merchant; replay fails; D1 stores hashes and HTTP-local cookies remain HttpOnly/Strict',
  )
  const authenticated = await expect(alice, '/api/auth/session', 200)
  assert.equal(authenticated.body.authenticated, true)
  assert.equal(authenticated.body.merchant.walletAddress, aliceAccount.address)
  const tampered = new Client()
  tampered.cookies.set('sg_session', '1'.repeat(64))
  await expect(tampered, '/api/resources', 401)
  const invalidStatus = await expect(tampered, '/api/auth/session', 200)
  assert.deepEqual(invalidStatus.body, { authenticated: false })
  assert.deepEqual(invalidStatus.response.headers.getSetCookie(), [])
  await expect(alice, '/api/auth/session', 403, 'GET', undefined, {
    'Sec-Fetch-Site': 'cross-site',
  })
  const beforeRotation = new Client()
  beforeRotation.cookies = new Map(alice.cookies)
  await login(alice, aliceAccount)
  assert.equal(
    beforeRotation.cookies.get('sg_session') !==
      alice.cookies.get('sg_session'),
    true,
  )
  await expect(beforeRotation, '/api/resources', 401)
  pass(
    're-authentication rotates the session and revokes the old token; cross-site session reads are denied',
  )
  await login(bob, bobAccount)
  pass(
    'server-backed session resolves verified merchant identity and rejects invalid token',
  )
  const input = {
    name: 'SG-03 local test resource',
    upstreamUrl: 'https://example.com/api/data',
    priceAtomic: '1001',
    payoutAddress: aliceAccount.address,
    responseConfig: { type: 'json', maxBytes: 65536, redirects: 'error' },
    network: 'eip155:8453',
    enabled: true,
  }
  const created = await expect(alice, '/api/resources', 201, 'POST', input)
  const resource = created.body.resource
  assert.deepEqual(
    { ...resource, id: undefined, createdAt: undefined, updatedAt: undefined },
    { ...input, id: undefined, createdAt: undefined, updatedAt: undefined },
  )
  assert.equal(
    (await expect(alice, '/api/resources', 200)).body.resources.length,
    1,
  )
  assert.deepEqual(
    (await expect(alice, `/api/resources/${resource.id}`, 200)).body.resource,
    resource,
  )
  assert.equal(
    (await expect(bob, '/api/resources', 200)).body.resources.length,
    0,
  )
  await expect(bob, `/api/resources/${resource.id}`, 404)
  await expect(bob, `/api/resources/${resource.id}`, 404, 'PATCH', {
    name: 'unauthorized',
  })
  await expect(bob, `/api/resources/${resource.id}`, 404, 'DELETE', {})
  assert.equal(
    (await expect(alice, `/api/resources/${resource.id}`, 200)).body.resource
      .name,
    input.name,
  )
  await expect(alice, '/api/resources', 422, 'POST', {
    ...input,
    merchantId: authenticated.body.merchant.id,
  })
  pass(
    'CRUD is persisted in real D1; merchant isolation applies to list, read, update and disable without client ownership claims',
  )
  await expect(
    alice,
    `/api/resources/${resource.id}`,
    403,
    'PATCH',
    { name: 'cross-site' },
    { Origin: 'https://attacker.invalid' },
  )
  await expect(
    alice,
    '/api/auth/logout',
    403,
    'POST',
    {},
    { 'X-SignalArc-Request': null },
  )
  await expect(alice, '/api/resources', 415, 'POST', input, {
    'Content-Type': 'text/plain',
  })
  for (const priceAtomic of [
    '0',
    '-1',
    '1.1',
    '1e6',
    '001',
    '1000000000000',
    1,
  ])
    await expect(alice, '/api/resources', 422, 'POST', {
      ...input,
      priceAtomic,
    })
  for (const upstreamUrl of [
    'http://example.com',
    'not a url',
    'https://localhost/api',
    'https://localhost.localdomain/api',
    'https://@example.com',
    'https://:@example.com',
    'https://127.0.0.1',
    'https://10.0.0.1',
    'https://169.254.169.254',
    'https://0x7f000001',
    'https://2130706433',
    'https://[::1]',
    'https://[2001:db8::1]',
    'https://8.8.8.8',
    'https://example.internal',
    'https://user:password@example.com',
    'https://example.com:8443',
    'https://example.com/#secret',
    'https://example.com/#',
    'https://example.com\\@localhost/',
  ])
    await expect(alice, '/api/resources', 422, 'POST', {
      ...input,
      upstreamUrl,
    })
  await expect(alice, '/api/resources', 422, 'POST', {
    ...input,
    payoutAddress: 'invalid',
  })
  await expect(alice, '/api/resources', 422, 'POST', {
    ...input,
    network: 'invalid:network',
  })
  await expect(alice, '/api/resources', 422, 'POST', {
    ...input,
    responseConfig: { ...input.responseConfig, redirects: 'follow' },
  })
  await expect(alice, '/api/resources', 422, 'POST', {
    ...input,
    responseConfig: {
      ...input.responseConfig,
      headers: { Authorization: 'not-allowed' },
    },
  })
  await expect(alice, '/api/resources', 413, 'POST', 'x'.repeat(16385))
  await expect(alice, '/api/resources', 400, 'POST', '{')
  await expect(
    alice,
    '/api/resources',
    413,
    'POST',
    '['.repeat(9) + '0' + ']'.repeat(9),
  )
  pass(
    'strict validation rejects imprecise prices, malformed/private/reserved URLs, unsafe redirects, invalid payout/network/config and oversized/deep bodies; CSRF is enforced',
  )
  await expect(alice, `/api/resources/${resource.id}`, 200, 'PATCH', {
    name: 'Edited local test',
    priceAtomic: '999999999999',
    upstreamUrl: 'https://example.com/api/updated',
    payoutAddress: bobAccount.address,
    responseConfig: { type: 'json', maxBytes: 131072, redirects: 'error' },
  })
  const edited = (await expect(alice, `/api/resources/${resource.id}`, 200))
    .body.resource
  assert.equal(edited.name, 'Edited local test')
  assert.equal(edited.priceAtomic, '999999999999')
  assert.equal(edited.upstreamUrl, 'https://example.com/api/updated')
  assert.equal(edited.payoutAddress, bobAccount.address)
  assert.deepEqual(edited.responseConfig, {
    type: 'json',
    maxBytes: 131072,
    redirects: 'error',
  })
  await expect(bob, `/api/resources/${resource.id}`, 404)
  await expect(alice, `/api/resources/${resource.id}`, 200, 'DELETE', {})
  assert.equal(
    (await expect(alice, `/api/resources/${resource.id}`, 200)).body.resource
      .enabled,
    false,
  )
  const snapshot = await runtime.control('snapshot')
  assert.equal(snapshot.resources.length, 1)
  assert.equal(snapshot.resources[0].enabled, 0)
  assert.equal(snapshot.attempts, 0)
  assert.equal(snapshot.receipts, 0)
  pass(
    'updates and disabling survive independent SQL/API reads; payment foundations remain empty',
  )
  await runtime.control('expireSession', {
    token: alice.cookies.get('sg_session'),
  })
  await expect(alice, '/api/resources', 401)
  assert.deepEqual((await expect(alice, '/api/auth/session', 200)).body, {
    authenticated: false,
  })
  await login(alice, aliceAccount)
  const replayLogout = new Client()
  replayLogout.cookies = new Map(alice.cookies)
  await expect(alice, '/api/auth/logout', 200, 'POST', {})
  await expect(replayLogout, '/api/resources', 401)
  assert.equal(alice.cookies.has('sg_session'), false)
  pass(
    'session expiry and logout invalidate server access even when an old cookie is replayed',
  )

  // The provider is explicitly a local EIP-1193 test double. Signatures are genuine
  // ECDSA signatures produced by the isolated Node account, not mocked successes.
  browser = await chromium.launch()
  const context = await browser.newContext({
    viewport: { width: 1280, height: 900 },
  })
  const external = []
  await context.route('**/*', (route) => {
    if (new URL(route.request().url()).origin !== runtime.origin) {
      external.push(route.request().url())
      return route.abort()
    }
    return route.continue()
  })
  const page = await context.newPage()
  const browserErrors = []
  page.on('pageerror', (error) => browserErrors.push(error.message))
  await page.exposeFunction('localTestSign', async (message) =>
    aliceAccount.signMessage({ message }),
  )
  await page.addInitScript(
    ({ address }) => {
      let chain = '0x0',
        connected = false
      const listeners = new Map()
      const emit = (name, data) => {
        for (const listener of listeners.get(name) ?? []) listener(data)
      }
      window.ethereum = {
        isMetaMask: false,
        on(name, listener) {
          listeners.set(name, [...(listeners.get(name) ?? []), listener])
          return this
        },
        removeListener(name, listener) {
          listeners.set(
            name,
            (listeners.get(name) ?? []).filter((value) => value !== listener),
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
            if (params[0].chainId !== '0x2105')
              throw new Error('Only Base permitted')
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
            const hex = params[0].slice(2),
              bytes = new Uint8Array(
                hex.match(/.{2}/g).map((byte) => parseInt(byte, 16)),
              )
            return window.localTestSign(new TextDecoder().decode(bytes))
          }
          throw new Error('Unsupported test provider operation: ' + method)
        },
      }
    },
    { address: aliceAccount.address },
  )
  await page.goto(`${runtime.origin}/manage`)
  await page.getByText('Not signed in.', { exact: true }).waitFor()
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
  await page
    .getByRole('button', { name: 'Sign in with Ethereum', exact: true })
    .click()
  await page.getByTestId('authenticated-wallet').waitFor()
  assert.match(
    await page.getByTestId('authenticated-wallet').textContent(),
    new RegExp(aliceAccount.address, 'i'),
  )
  assert.equal(await page.evaluate(() => localStorage.length), 0)
  assert.equal(
    await page.evaluate(
      () =>
        document.cookie.includes('sg_session') ||
        document.cookie.includes('sg_challenge'),
    ),
    false,
  )
  pass(
    'browser uses injected API, blocks wrong network, switches only on click and signs a real local SIWE challenge; no token is in localStorage',
  )
  await page
    .getByRole('button', { name: 'Create resource', exact: true })
    .click()
  await page
    .getByLabel('Resource name', { exact: true })
    .fill('Browser local test resource')
  await page.getByLabel('USDC price', { exact: true }).fill('0.0000001')
  await page
    .getByLabel('HTTPS upstream URL', { exact: true })
    .fill('https://example.com/browser-api')
  await page.getByRole('button', { name: 'Save resource', exact: true }).click()
  await page
    .getByRole('alert')
    .filter({ hasText: 'at most six decimal places' })
    .waitFor()
  await page.getByLabel('USDC price', { exact: true }).fill('0.000001')
  await page.getByRole('button', { name: 'Save resource', exact: true }).click()
  await page
    .getByRole('button', {
      name: 'Edit Browser local test resource',
      exact: true,
    })
    .waitFor()
  const browserCreated = (await runtime.control('snapshot')).resources.find(
    (row) => row.id !== resource.id,
  )
  assert.equal(browserCreated.price_atomic, '1')
  await page
    .getByRole('button', {
      name: 'Edit Browser local test resource',
      exact: true,
    })
    .click()
  await page
    .getByLabel('Resource name', { exact: true })
    .fill('Browser edited resource')
  await page.getByRole('button', { name: 'Save resource', exact: true }).click()
  await page
    .getByRole('button', {
      name: 'Disable Browser edited resource',
      exact: true,
    })
    .click()
  await page
    .getByRole('button', {
      name: 'Disable Browser edited resource',
      exact: true,
    })
    .waitFor({ state: 'visible' })
  await page
    .locator('[data-slot="card"]')
    .filter({ has: page.getByText('Browser edited resource', { exact: true }) })
    .getByText('Disabled', { exact: true })
    .waitFor()
  const browserDisabled = (await runtime.control('snapshot')).resources.find(
    (row) => row.id === browserCreated.id,
  )
  assert.equal(browserDisabled.enabled, 0)
  assert.equal(browserDisabled.price_atomic, '1')
  await page.screenshot({ path: '.wrangler/sg03-desktop.png', fullPage: true })
  await page.setViewportSize({ width: 390, height: 844 })
  assert.equal(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
    true,
  )
  await page.screenshot({ path: '.wrangler/sg03-mobile.png', fullPage: true })
  await page.getByRole('button', { name: 'Log out', exact: true }).click()
  await page.getByText('Not signed in.', { exact: true }).waitFor()
  await page
    .getByRole('button', { name: 'Disconnect wallet', exact: true })
    .click()
  await page.getByText('No wallet connected.', { exact: true }).waitFor()
  assert.deepEqual(external, [])
  assert.deepEqual(browserErrors, [])
  pass(
    'desktop/mobile UI creates, reads, edits, disables and logs out against real Pages/D1; no upstream, blockchain RPC or external fetch occurs',
  )
  await context.close()
  console.log(
    `${passed} SG-03 checks passed in local Pages/workerd and D1; EOA signatures real, injected browser provider simulated`,
  )
} finally {
  if (browser) await browser.close()
  await runtime.close()
}
