import { mkdtemp, mkdir, cp, readFile, writeFile, rm } from 'node:fs/promises'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import assert from 'node:assert/strict'
import { keccak256 } from 'viem'
const root = resolve(import.meta.dirname, '..')
const check = process.argv.includes('--check')
const sha = (v) => createHash('sha256').update(v).digest('hex')
await mkdir(join(root, '.wrangler'), { recursive: true })
const temp = await mkdtemp(join(root, '.wrangler/contract-release-'))
try {
  await cp(join(root, 'contracts/src'), join(temp, 'src'), { recursive: true })
  const config = await readFile(join(root, 'contracts/foundry.toml'), 'utf8')
  await writeFile(join(temp, 'foundry.toml'), config)
  execFileSync('forge', ['build', '--root', temp, '--force'], {
    stdio: 'pipe',
    env: process.env,
  })
  const a = JSON.parse(
    await readFile(
      join(temp, 'out/EndpointRegistry.sol/EndpointRegistry.json'),
      'utf8',
    ),
  )
  const metadata = JSON.parse(a.rawMetadata)
  assert.equal(metadata.compiler.version, '0.8.38+commit.1835d247')
  assert.equal(metadata.settings.evmVersion, 'cancun')
  assert.equal(metadata.settings.viaIR ?? false, false)
  assert.equal(metadata.settings.optimizer.runs, 200)
  assert.equal(metadata.settings.optimizer.details.yul, false)
  const init = Buffer.from(a.bytecode.object.replace(/^0x/, ''), 'hex')
  const runtime = Buffer.from(
    a.deployedBytecode.object.replace(/^0x/, ''),
    'hex',
  )
  const record = {
    schema: 1,
    contract: 'src/EndpointRegistry.sol:EndpointRegistry',
    chainId: 8453,
    constructorArguments: [],
    productionDeploymentApproved: false,
    compiler: metadata.compiler.version,
    linuxCompilerSha256:
      '65c3180a336eabb6bdc4bbd49cc405aeb233976964ae6c11fba2a6c8be8f3243',
    compilerManifest:
      'https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/list.json',
    settings: metadata.settings,
    sourceSha256: sha(
      await readFile(join(root, 'contracts/src/EndpointRegistry.sol')),
    ),
    foundryConfigSha256: sha(config),
    initcodeBytes: init.length,
    initcodeSha256: sha(init),
    initcodeKeccak256: keccak256(a.bytecode.object),
    runtimeBytes: runtime.length,
    runtimeSha256: sha(runtime),
    runtimeKeccak256: keccak256(a.deployedBytecode.object),
    runtimeHexLineSha256: sha(a.deployedBytecode.object + '\n'),
    abi: a.abi,
    storageLayout: a.storageLayout,
  }
  const file = join(root, 'docs/CONTRACT_RELEASE.json')
  if (check)
    assert.deepEqual(
      record,
      JSON.parse(await readFile(file, 'utf8')),
      'Release record differs from a fresh isolated build',
    )
  else await writeFile(file, JSON.stringify(record, null, 2) + '\n')
  console.log(
    `${check ? 'Verified' : 'Recorded'} isolated solc ${record.compiler}; runtime ${runtime.length} bytes, initcode ${init.length} bytes; runtime keccak ${record.runtimeKeccak256}`,
  )
} finally {
  await rm(temp, { recursive: true, force: true })
}
