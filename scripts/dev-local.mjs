import { createServer } from 'node:net'
import { spawn } from 'node:child_process'
import { resolve } from 'node:path'

const args = process.argv.slice(2)
if (
  args.length &&
  (args.length !== 2 ||
    args[0] !== '--port' ||
    !/^\d+$/.test(args[1]) ||
    Number(args[1]) < 1 ||
    Number(args[1]) > 65535)
)
  throw new Error('Usage: npm run pages:dev -- --port <free local port>')
const server = createServer()
await new Promise((done, reject) => {
  server.once('error', reject)
  server.listen(args.length ? Number(args[1]) : 0, '127.0.0.1', done)
})
const port = server.address().port
await new Promise((done) => server.close(done))
const child = spawn(
  process.execPath,
  [
    resolve('node_modules/wrangler/bin/wrangler.js'),
    'pages',
    'dev',
    'dist',
    '--ip',
    '127.0.0.1',
    '--port',
    String(port),
    '--d1',
    'SIGNALARC_DB',
    '--binding',
    'APP_ENV=local',
    '--binding',
    `APP_ORIGIN=http://127.0.0.1:${port}`,
  ],
  { stdio: 'inherit', env: { ...process.env, WRANGLER_SEND_METRICS: 'false' } },
)
child.on('exit', (code) => {
  process.exitCode = code ?? 1
})
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
