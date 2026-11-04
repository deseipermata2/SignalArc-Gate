import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { resolve, dirname, join } from 'node:path'
import { build } from 'esbuild'
const root = resolve(import.meta.dirname, '..')
// Build-only candidate using public supported exports; never creates JWTs/clients or calls CDP.
const result = await build({
  stdin: {
    contents:
      "export { generateJwt } from '@coinbase/cdp-sdk/auth'; export { HTTPFacilitatorClient } from '@x402/core/server';",
    resolveDir: root,
  },
  bundle: true,
  format: 'esm',
  platform: 'browser',
  conditions: ['workerd', 'worker', 'browser'],
  write: false,
  metafile: true,
})
const inputs = Object.keys(result.metafile.inputs)
assert.equal(
  inputs.some((p) => /@x402\/svm|@solana(?:-program)?\//.test(p)),
  false,
)
const zodVersions = new Set()
for (const input of inputs.filter((p) => /\/zod\//.test(p))) {
  let dir = dirname(resolve(root, input))
  while (dir !== dirname(dir)) {
    let pkg
    try {
      pkg = JSON.parse(await readFile(join(dir, 'package.json'), 'utf8'))
    } catch {
      /* ascend to package root */
    }
    if (pkg?.name === 'zod') {
      zodVersions.add(pkg.version)
      break
    }
    dir = dirname(dir)
  }
}
for (const version of zodVersions) {
  const [major, minor, patch] = version.split('.').map(Number)
  assert.ok(
    major > 4 || (major === 4 && (minor > 6 || (minor === 6 && patch >= 6))),
  )
}
await mkdir(join(root, '.wrangler'), { recursive: true })
await writeFile(
  join(root, '.wrangler/cdp-auth-boundary-meta.json'),
  JSON.stringify(result.metafile, null, 2),
)
console.log(
  JSON.stringify({
    inputs: inputs.length,
    unminifiedBytes: result.outputFiles[0].contents.length,
    zodVersions: [...zodVersions],
    svm: false,
    solana: false,
    credentialsUsed: false,
  }),
)
console.log(
  'BUILD CANDIDATE ONLY: installed advisories remain unresolved; no JWT, production authentication or settlement was tested; no replacement integration was activated.',
)
