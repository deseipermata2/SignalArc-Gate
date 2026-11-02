import { build } from 'vite'
import { execFileSync } from 'node:child_process'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
const root = resolve(import.meta.dirname, '..')
const dir = join(root, '.wrangler/dependency-exposure-current')
await mkdir(dir, { recursive: true })
const forbidden =
  /server\/sg0[57]\/|tests\/|node_modules\/(?:@coinbase|@x402|zod|minimatch)\//
const meta = join(dir, 'functions.json')
execFileSync(
  process.execPath,
  [
    join(root, 'node_modules/wrangler/bin/wrangler.js'),
    'pages',
    'functions',
    'build',
    '--outdir',
    join(dir, 'functions'),
    '--metafile',
    meta,
  ],
  { cwd: root, stdio: 'pipe' },
)
const inputs = Object.keys(JSON.parse(await readFile(meta, 'utf8')).inputs)
assert.deepEqual(
  inputs.filter((p) => forbidden.test(p)),
  [],
  'Payment/test/dependency boundary reached public Functions',
)
let browser = [],
  chunks = []
await build({
  build: { write: false },
  plugins: [
    {
      name: 'release-dependency-graph',
      generateBundle(_options, bundle) {
        browser = [...this.getModuleIds()]
        chunks = Object.values(bundle)
          .filter((v) => v.type === 'chunk')
          .map((v) => ({ name: v.fileName, modules: Object.keys(v.modules) }))
      },
    },
  ],
})
assert.deepEqual(
  browser.filter((p) => forbidden.test(p)),
  [],
  'Payment/test/dependency boundary reached browser graph',
)
await writeFile(
  join(dir, 'summary.json'),
  JSON.stringify(
    { functionsInputs: inputs, browserInputs: browser, chunks },
    null,
    2,
  ) + '\n',
)
console.log(
  `Public Functions: ${inputs.length} inputs; browser: ${browser.length} inputs, ${chunks.length} chunks; no payment/test SDK, Zod or minimatch code in either input graph. This does not remediate installed advisories.`,
)
