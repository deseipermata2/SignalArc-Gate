import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
const safeLeaves = new Set([
  'server/sg05/bounds.ts',
  'server/sg05/clock.ts',
  'server/sg05/registry.ts',
  'server/sg07/rpc.ts',
  'server/sg07/registry.ts',
  'server/sg07/settlement-evidence.ts',
  'server/sg07/builder-code.ts',
])
/** Exact production capability allowlist. Local gateway, mocks, full CDP x402 and vulnerable parsers stay forbidden. */
export function unsafePaymentInputs(inputs) {
  return inputs.filter((raw) => {
    const p = raw.replaceAll('\\', '/')
    if (
      /(?:^|\/)tests\/|(?:^|\/)minimatch\/|node_modules\/(?:@solana|@x402\/svm)\//.test(
        p,
      )
    )
      return true
    const local = p.match(/(?:^|\/)(server\/sg0[57]\/.*)$/)?.[1]
    if (local && !safeLeaves.has(local)) return true
    if (
      p.includes('node_modules/@coinbase/cdp-sdk/') &&
      !/node_modules\/@coinbase\/cdp-sdk\/(?:_esm\/auth\/|_esm\/(?:errors|version|utils\/(?:bigint|sortKeys)|openapi-client\/publicOperations.gen)\.js)/.test(
        p,
      )
    )
      return true
    if (
      p.includes('node_modules/@x402/') &&
      !/node_modules\/@x402\/(?:core\/|extensions\/.*(?:builder|chunk))/.test(p)
    )
      return true
    if (/node_modules\/zod\//.test(p)) {
      const prefix = p.slice(
        p.indexOf('node_modules/'),
        p.lastIndexOf('node_modules/zod/') + 'node_modules/zod/'.length,
      )
      const v = JSON.parse(
        readFileSync(resolve(prefix, 'package.json'), 'utf8'),
      )
        .version.split('.')
        .map(Number)
      if (v[0] !== 4 || v[1] < 6 || (v[1] === 6 && v[2] < 6)) return true
    }
    return false
  })
}
