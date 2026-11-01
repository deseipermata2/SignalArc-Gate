import assert from 'node:assert/strict'
import { join, resolve } from 'node:path'
import { readFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { localRuntime } from '../../scripts/local-runtime.mjs'
const root = resolve(import.meta.dirname, '../..')
const runtime = await localRuntime({
  includeApp: true,
  fixture: {
    prefix: 'upstream-security',
    module: join(root, 'tests/upstream-security/handler.ts'),
    bindings: { UPSTREAM_SECURITY_LOCAL_ONLY: 'yes' },
  },
})
let n = 0
const pass = (s) => {
  n++
  console.log('PASS ' + s)
}
async function call(action, mode, url) {
  const r = await fetch(runtime.origin + '/upstream-security/check', {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'Content-Type': 'application/json',
      'X-Local-Only': 'yes',
      Authorization: 'Bearer LOCAL_TEST_ONLY',
      Cookie: 'local_marker=1',
      'PAYMENT-SIGNATURE': 'LOCAL_TEST_ONLY',
    },
    body: JSON.stringify({ action, mode, url }),
  })
  return { r, body: await r.json() }
}
try {
  await runtime.control('migrate')
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  pass(
    'actual local D1 binding and five unchanged migrations execute without remote configuration',
  )
  for (const url of [
    'https://localhost',
    'https://localhost.localdomain',
    'https://10.0.0.1',
    'https://172.16.0.1',
    'https://192.168.1.1',
    'https://127.0.0.1',
    'https://169.254.169.254',
    'https://100.100.100.200',
    'https://[::1]',
    'https://[fe80::1]',
    'https://[fc00::1]',
    'https://[::ffff:127.0.0.1]',
    'https://[ff02::1]',
    'https://224.0.0.1',
    'https://192.0.2.1',
    'https://0177.0.0.1',
    'https://0x7f000001',
    'https://2130706433',
    'https://127.1',
    'https://%31%32%37.0.0.1',
    'http://api.example.com',
    'file:///etc/passwd',
    'ftp://api.example.com',
    'https://user:pass@api.example.com',
    'https://@api.example.com',
    'https://api.example.com:8443',
    'https://api.example.com:0443',
    'https://api.example.com:',
    'https://api.example.com\\@localhost',
    'https://api.example.com.',
    'https://api..example.com',
    'https://api_example.com',
    'https://ａｐｉ.example.com',
    'https://%61pi.example.com',
    'https://api.example.com/#x',
    ' https://api.example.com',
    'not a URL',
    'https://metadata.google.internal',
  ]) {
    const v = await call('url', '', url)
    assert.equal(v.r.status, 422, url)
    assert.equal(v.body.calls, 0)
  }
  pass(
    'URL policy rejects localhost, private/reserved/metadata/IP literals, mapped IPv6, encoded/octal/dword IPs and prohibited schemes',
  )
  pass(
    'ASCII authority policy rejects userinfo, ambiguous ports, encoded/Unicode hosts, malformed names, whitespace and parser confusion',
  )
  const canonical = await call(
    'url',
    '',
    'https://API.example.com:443/v1/local-json',
  )
  assert.equal(canonical.body.url, 'https://api.example.com/v1/local-json')
  const aLabel = await call('url', '', 'https://xn--bcher-kva.com/data')
  assert.equal(aLabel.r.status, 200)
  pass(
    'canonical ASCII hostname/default port normalization is deterministic; explicit A-label IDNs remain syntax-only registrations',
  )
  for (const mode of ['missing-entry', 'wrong-resource', 'wrong-merchant']) {
    const v = await call('delivery', mode)
    assert.equal(v.r.status, 503)
    assert.equal(v.body.calls, 0)
    pass(
      mode +
        ' fails the server-owned exact resource/merchant/URL policy before transport',
    )
  }
  const miss = await call('delivery', '', 'https://api.example.com/v1/other')
  assert.equal(miss.r.status, 503)
  assert.equal(miss.body.calls, 0)
  pass(
    'an allowed origin alone does not approve another path or a query-bearing resource',
  )
  const query = await call(
    'delivery',
    '',
    'https://api.example.com/v1/local-json?key=LOCAL_TEST_ONLY',
  )
  assert.equal(query.r.status, 503)
  assert.equal(query.body.calls, 0)
  for (const mode of ['rebind', 'cname']) {
    const v = await call('dns-policy', mode)
    assert.equal(v.r.status, 503)
    assert.equal(v.body.calls, 0)
    assert.equal(v.body.policyOnly, true)
    pass(
      mode +
        ' model proves production DENIAL even after a matching URL policy, not actual DNS/connection safety',
    )
  }
  const ok = await call('delivery', '')
  assert.equal(ok.r.status, 200)
  assert.equal(ok.body.calls, 1)
  assert.equal(ok.body.value.localSimulationOnly, true)
  assert.equal(
    ok.r.headers.get('cache-control'),
    'private, no-store, max-age=0',
  )
  pass(
    'fresh GET forwards only Accept with no body/buyer authorization/cookies/payment headers; returned fixture content is no-store',
  )
  for (const [mode, status] of [
    ['redirect', 502],
    ['partial', 502],
    ['header-timeout', 504],
    ['slow-stream', 504],
    ['late-header', 504],
    ['late-body', 504],
    ['final-clock-hang', 504],
    ['clock-rollback', 504],
    ['large', 502],
    ['declared-large', 502],
    ['content-type', 502],
    ['charset', 502],
    ['encoding', 502],
    ['large-header', 502],
    ['bad-length', 502],
    ['invalid-json', 400],
    ['bad-utf8', 503],
    ['depth', 413],
    ['collection', 413],
  ]) {
    const v = await call('delivery', mode)
    assert.equal(v.r.status, status, mode)
    assert.equal(v.body.calls, 1)
    assert.equal(v.body.value, undefined)
    if (mode === 'slow-stream') assert.ok(v.body.cancelled >= 1)
    pass(mode + ' rejects without protected JSON or any redirect/retry request')
  }
  assert.equal((await call('egress', '')).body.blocked, 1)
  pass('test isolate global fetch rejects egress before a native network call')
  const meta = join(root, '.wrangler/upstream-production-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/upstream-production-build'),
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
      /tests\/|server\/sg05\/|server\/sg07\/|@x402|@coinbase/.test(x),
    ),
    false,
  )
  for (const p of ['/api/upstream', '/api/upstream-security', '/api/pay/x']) {
    const r = await fetch(runtime.origin + p, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        UPSTREAM_SECURITY_LOCAL_ONLY: 'yes',
      },
      body: JSON.stringify({ transport: 'mock', allowlist: true }),
    })
    assert.equal(r.status, 404)
    assert.equal(r.headers.get('PAYMENT-RESPONSE'), null)
    await r.arrayBuffer()
  }
  pass(
    'production Functions excludes simulated transport/payment code; forged flags and bodies cannot open paid or proxy routes',
  )
  console.log(
    `${n} upstream-security checks passed in native local workerd/D1. Allowlist/DNS scenarios are POLICY TESTS ONLY; no live upstream connection.`,
  )
} finally {
  await runtime.close()
}
