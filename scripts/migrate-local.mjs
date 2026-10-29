import { resolve } from 'node:path'
import { localRuntime } from './local-runtime.mjs'

// Only a local disk state directory is accepted. There is no remote execution option.
const index = process.argv.indexOf('--persist-to')
if (
  process.argv
    .slice(2)
    .some(
      (arg, i, args) =>
        arg !== '--persist-to' && args[i - 1] !== '--persist-to',
    )
)
  throw new Error('Only --persist-to <local directory> is supported')
if (index >= 0 && !process.argv[index + 1])
  throw new Error('--persist-to requires a local directory')
const runtime = await localRuntime({
  statePath: resolve(index < 0 ? '.wrangler/state' : process.argv[index + 1]),
})
try {
  const result = await runtime.control('migrate')
  console.log(
    `Local D1 migrations: ${result.applied.length ? result.applied.join(', ') : 'already applied (checksums verified)'}`,
  )
} finally {
  await runtime.close()
}
