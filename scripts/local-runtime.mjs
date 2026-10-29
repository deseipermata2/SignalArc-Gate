import { spawn } from 'node:child_process'
import { createServer } from 'node:http'
import {
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  writeFile,
  copyFile,
  cp,
  rm,
} from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { setTimeout as delay } from 'node:timers/promises'
import { createHash } from 'node:crypto'

const root = resolve(import.meta.dirname, '..')
async function port() {
  const server = createServer()
  await new Promise((done, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', done)
  })
  const value = server.address().port
  await new Promise((done) => server.close(done))
  return value
}
/** Local Pages/D1 only. The supplied state directory is never a remote identifier. */
export async function localRuntime({
  statePath,
  includeApp = false,
  controls = false,
} = {}) {
  await mkdir(join(root, '.wrangler'), { recursive: true })
  const temp = await mkdtemp(join(root, '.wrangler/sg03-'))
  const migrations = []
  for (const name of (await readdir(join(root, 'migrations')))
    .filter((name) => /^\d+.*\.sql$/.test(name))
    .sort()) {
    const sql = await readFile(join(root, 'migrations', name), 'utf8')
    // The reviewed migration files use no triggers or semicolons inside literals.
    const statements = sql
      .split(';')
      .map((sql) => sql.trim())
      .filter(Boolean)
    migrations.push({
      name,
      digest: createHash('sha256').update(sql).digest('hex'),
      statements,
    })
  }
  const serverPort = await port(),
    inspectorPort = await port()
  const origin = `http://127.0.0.1:${serverPort}`
  const config = JSON.parse(
    await readFile(join(root, 'wrangler.jsonc'), 'utf8'),
  )
  await mkdir(join(temp, 'functions/api'), { recursive: true })
  await cp(join(root, 'dist'), join(temp, 'assets'), { recursive: true })
  await copyFile(
    join(root, 'functions/api/health.ts'),
    join(temp, 'functions/api/health.ts'),
  )
  if (includeApp)
    await writeFile(
      join(temp, 'functions/api/[[path]].ts'),
      `export { onRequest } from ${JSON.stringify(join(root, 'functions/api/[[path]].ts'))}`,
    )
  await writeFile(
    join(temp, 'wrangler.jsonc'),
    JSON.stringify({
      name: 'signalarc-sg03-local',
      pages_build_output_dir: './assets',
      compatibility_date: config.compatibility_date,
    }),
  )
  // This test/CLI control route is generated only in the temporary local project.
  // No arbitrary SQL input, remote bindings, credentialed APIs or outbound fetch.
  await writeFile(
    join(temp, 'functions/__local.ts'),
    `
const migrations = ${JSON.stringify(migrations)}
import { apiConfig, cookie } from ${JSON.stringify(join(root, 'server/sg03/http.ts'))}
globalThis.fetch = async () => { throw new Error('SG-03 local runtime blocks network egress') }
export async function onRequest({ request, env }) {
  if (new URL(request.url).origin !== env.APP_ORIGIN || env.APP_ENV !== 'local' || request.method !== 'POST' || request.headers.get('Origin') !== env.APP_ORIGIN || request.headers.get('X-Local-Only') !== '1') return new Response('Local operation disabled', {status:403})
  const db = env.SIGNALARC_DB
  const check = await db.prepare('SELECT 1').all()
  if (check.meta.served_by !== 'miniflare.db') return new Response('Local D1 required', {status:403})
  const body = await request.json()
  if (body.action === 'migrate') {
    await db.prepare('CREATE TABLE IF NOT EXISTS local_migrations (name TEXT PRIMARY KEY, digest TEXT NOT NULL, applied_at INTEGER NOT NULL)').run()
    const applied = []
    for (const migration of migrations) {
      const previous = await db.prepare('SELECT digest FROM local_migrations WHERE name = ?').bind(migration.name).first()
      if (previous) { if (previous.digest !== migration.digest) throw new Error('Applied migration checksum changed'); continue }
      await db.batch([...migration.statements.map(sql => db.prepare(sql)), db.prepare('INSERT INTO local_migrations (name, digest, applied_at) VALUES (?, ?, ?)').bind(migration.name, migration.digest, Date.now())])
      applied.push(migration.name)
    }
    return Response.json({applied, localOnly:true})
  }
  if (!${JSON.stringify(controls)}) return new Response('Not found',{status:404})
  if (body.action === 'cookiePolicy') {
    const config = apiConfig(new Request('https://example.com/api/auth/session'), { ...env, APP_ORIGIN:'https://example.com', APP_ENV:'production' })
    let insecureRefused = false
    try { apiConfig(new Request('http://example.com/api/auth/session'), { ...env, APP_ORIGIN:'http://example.com', APP_ENV:'local' }) } catch { insecureRefused = true }
    return Response.json({ session:cookie(config.cookieName,'',0,config.secure), challenge:cookie(config.challengeName,'',0,config.secure), insecureRefused })
  }
  if (body.action === 'expireNonce' || body.action === 'expiredMessage') {
    const nonceHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.nonce))),b=>b.toString(16).padStart(2,'0')).join('')
    const row = await db.prepare('SELECT message FROM auth_nonces WHERE nonce_hash = ?').bind(nonceHash).first()
    const issued = Date.now()-600000, expires = Date.now()-300000
    const message = body.action === 'expiredMessage' ? row.message.replace(/Issued At: .+/, 'Issued At: '+new Date(issued).toISOString()).replace(/Expiration Time: .+/, 'Expiration Time: '+new Date(expires).toISOString()) : row.message
    await db.prepare('UPDATE auth_nonces SET issued_at = ?, expires_at = ?, message = ? WHERE nonce_hash = ?').bind(issued,expires,message,nonceHash).run()
    return Response.json({message})
  }
  if (body.action === 'expireSession') {
    const tokenHash = Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(body.token))),b=>b.toString(16).padStart(2,'0')).join('')
    await db.prepare('UPDATE sessions SET created_at = ?, expires_at = ? WHERE token_hash = ?').bind(Date.now()-600000,Date.now()-1,tokenHash).run()
    return Response.json({expired:true})
  }
  if (body.action === 'snapshot') {
    const merchants = (await db.prepare('SELECT id, wallet_address FROM merchants').all()).results
    const sessions = (await db.prepare('SELECT token_hash, revoked_at FROM sessions').all()).results
    const resources = (await db.prepare('SELECT id, merchant_id, price_atomic, enabled FROM api_resources').all()).results
    const attempts = await db.prepare('SELECT COUNT(*) AS count FROM payment_attempts').first()
    const receipts = await db.prepare('SELECT COUNT(*) AS count FROM payment_receipts').first()
    return Response.json({merchants,sessions,resources,attempts:attempts.count,receipts:receipts.count})
  }
  if (body.action === 'foreignKeyCheck') {
    let rejected = false
    try { await db.prepare('INSERT INTO sessions (token_hash,merchant_id,origin,chain_id,created_at,expires_at) VALUES (?,?,?,?,?,?)').bind('f'.repeat(64),'missing-merchant',env.APP_ORIGIN,8453,1,2).run() } catch { rejected = true }
    return Response.json({rejected})
  }
  if (body.action === 'egress') {
    let blocked = false
    try { await fetch('https://example.invalid/') } catch { blocked = true }
    return Response.json({blocked})
  }
  return new Response('Not found',{status:404})
}
`,
  )
  const child = spawn(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'dev',
      'assets',
      '--ip',
      '127.0.0.1',
      '--port',
      String(serverPort),
      '--inspector-port',
      String(inspectorPort),
      '--persist-to',
      statePath ? resolve(statePath) : join(temp, 'state'),
      '--d1',
      'SIGNALARC_DB',
      '--binding',
      'BASE_CHAIN_ID=8453',
      '--binding',
      'APP_ENV=local',
      '--binding',
      `APP_ORIGIN=${origin}`,
    ],
    {
      cwd: temp,
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, CI: 'true', WRANGLER_SEND_METRICS: 'false' },
    },
  )
  // Do not collect or print request bodies, cookies, signatures or test key material.
  let logs = ''
  child.stdout.on('data', (data) => {
    logs += data
  })
  child.stderr.on('data', (data) => {
    logs += data
  })
  async function close() {
    if (child.exitCode === null) {
      process.kill(-child.pid, 'SIGTERM')
      await Promise.race([
        new Promise((done) => child.once('exit', done)),
        delay(3000),
      ])
    }
    await rm(temp, { recursive: true, force: true })
  }
  try {
    for (let i = 0; i < 300; i++) {
      if (child.exitCode !== null)
        throw new Error('Local Pages process exited during startup')
      try {
        if ((await fetch(`${origin}/api/health`)).status === 200) break
      } catch {
        /* starting */
      }
      if (i === 299) throw new Error('Local Pages startup timeout')
      await delay(100)
    }
    async function control(action, fields = {}) {
      const response = await fetch(`${origin}/__local`, {
        method: 'POST',
        redirect: 'error',
        headers: {
          Origin: origin,
          'X-Local-Only': '1',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ action, ...fields }),
      })
      if (!response.ok)
        throw new Error(`Local ${action} failed with HTTP ${response.status}`)
      return response.json()
    }
    return { origin, control, close, diagnostic: () => logs }
  } catch (error) {
    await close()
    throw error
  }
}
