import assert from 'node:assert/strict'
import { resolve, join } from 'node:path'
import { execFileSync } from 'node:child_process'
import { readFile, mkdtemp, rm } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { localRuntime } from '../../scripts/local-runtime.mjs'
const root = resolve(import.meta.dirname, '../..')
const upgradeState = await mkdtemp(join(root, '.wrangler/quarantine-upgrade-'))
const migrationFourDigest = createHash('sha256')
  .update(
    await readFile(join(root, 'migrations/0004_sg07_registry_review.sql')),
  )
  .digest('hex')
let runtime = await localRuntime({
  statePath: upgradeState,
  migrationNames: [
    '0001_sg03.sql',
    '0002_sg05.sql',
    '0003_sg06_reporting_indexes.sql',
    '0004_sg07_registry_review.sql',
  ],
  includeApp: true,
  controls: true,
  fixture: {
    prefix: 'registry-review',
    module: join(root, 'tests/registry-admission/handler.ts'),
    bindings: { REGISTRY_REVIEW_LOCAL_ONLY: 'yes' },
  },
})
let count = 0
const pass = (s) => {
  count++
  console.log('PASS ' + s)
}
async function call(action, id, extra = {}) {
  const r = await fetch(runtime.origin + '/registry-review/control', {
    method: 'POST',
    headers: {
      Origin: runtime.origin,
      'X-Local-Only': 'yes',
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ action, id, ...extra }),
  })
  return { status: r.status, body: await r.json() }
}
async function seed(mode) {
  return (await call('seed', '', { mode })).body.id
}
async function inspect(id) {
  return (await call('inspect', id)).body
}
try {
  const applied = await runtime.control('migrate')
  assert.equal(applied.applied.at(-1), '0004_sg07_registry_review.sql')
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  const legacyId = await seed()
  await call('review', legacyId)
  await call('review', legacyId, { mode: 'conflict' })
  const legacyConflict = await inspect(legacyId)
  assert.equal(legacyConflict.binding.review_conflicted, 1)
  await call('recreate', legacyId)
  const legacyReset = await inspect(legacyId)
  assert.equal(legacyReset.binding.review_conflicted, 0)
  assert.ok(legacyReset.journal.some((x) => x.outcome === 'conflict'))
  pass(
    'migration 0004 reproduction: deletion/reinsertion clears the row flag while conflict history survives',
  )
  const flaggedId = await seed()
  assert.equal(
    (await call('legacyFlag', flaggedId)).body.legacyQuarantine,
    true,
  )
  await runtime.close()
  runtime = await localRuntime({
    statePath: upgradeState,
    includeApp: true,
    controls: true,
    fixture: {
      prefix: 'registry-review',
      module: join(root, 'tests/registry-admission/handler.ts'),
      bindings: { REGISTRY_REVIEW_LOCAL_ONLY: 'yes' },
    },
  })
  assert.deepEqual((await runtime.control('migrate')).applied, [
    '0005_sg07_persistent_quarantine.sql',
    '0006_sg07_api_budget.sql',
    '0007_sg07_settlement_observations.sql',
  ])
  assert.equal((await runtime.control('migrate')).applied.length, 0)
  const repaired = await inspect(legacyId)
  assert.equal(repaired.binding.review_conflicted, 1)
  assert.equal(repaired.binding.source, 'unconfirmed')
  for (const old of legacyReset.journal)
    assert.ok(
      repaired.journal.some(
        (x) => x.id === old.id && x.payload_json === old.payload_json,
      ),
    )
  assert.equal(
    createHash('sha256')
      .update(
        await readFile(join(root, 'migrations/0004_sg07_registry_review.sql')),
      )
      .digest('hex'),
    migrationFourDigest,
  )
  pass(
    'forward migration repairs an already-recreated binding, preserves every journal row and migration 0004 digest, and repeats safely',
  )
  const backfilled = await inspect(flaggedId)
  assert.equal(backfilled.binding.source, 'unconfirmed')
  assert.ok(
    backfilled.journal.some(
      (x) =>
        x.source_id === 'quarantine_flag_backfill' &&
        x.outcome === 'conflict' &&
        x.provenance === 'database_history',
    ),
  )
  await call('recreate', flaggedId)
  assert.equal((await inspect(flaggedId)).binding.review_conflicted, 1)
  pass(
    'a legacy flag without observation history is durably backfilled and survives later recreation',
  )

  for (const kind of ['missing', 'unconfirmed']) {
    const id = await seed(kind),
      review = await call('review', id),
      state = await inspect(id)
    assert.equal(review.status, 200)
    assert.equal(
      state.journal.filter((x) => x.kind === 'observation').length,
      1,
    )
    assert.equal((await call('payment', id)).body.authorized, false)
    assert.equal(state.receipts, 0)
    pass(
      kind +
        ' binding remains unable to authorize payment; review history persisted',
    )
  }
  for (const mode of [
    'wrong-chain',
    'wrong-address',
    'wrong-code-policy',
    'wrong-owner',
    'pending',
    'wrong-price',
    'wrong-payout',
    'wrong-hash',
    'stale',
    'timeout',
    'malformed',
    'disabled',
  ]) {
    const id = await seed(),
      before = await inspect(id),
      r = await call('review', id, { mode }),
      after = await inspect(id)
    assert.equal(r.status, 200, mode)
    assert.equal(after.binding.source, 'unconfirmed')
    assert.equal(after.binding.generation, before.binding.generation + 1)
    assert.equal(
      after.journal.filter((x) => x.kind === 'observation').length,
      1,
    )
    assert.equal(after.receipts, 0)
    assert.ok(
      JSON.parse(
        after.journal.find((x) => x.kind === 'observation').payload_json,
      ).reads.length > 0,
    )
    assert.equal((await call('payment', id)).body.authorized, false)
    pass(
      mode +
        ' observation is durably rejected and invalidates authorization without a receipt',
    )
  }
  for (const source of ['onchain_confirmed', 'verified_mainnet']) {
    const id = await seed(),
      before = await inspect(id)
    assert.equal((await call('review', id, { source })).status, 503)
    assert.equal(
      (await inspect(id)).binding.generation,
      before.binding.generation,
    )
    pass(
      'forged observation provenance ' +
        source +
        ' cannot acquire an internal review capability',
    )
  }
  {
    const id = await seed()
    assert.equal((await call('forge', id)).body.rejected, true)
    assert.equal((await inspect(id)).binding.source, 'local_simulation')
    assert.equal((await call('crudForge', id)).body.rejected, true)
    pass(
      'D1 rejects forged confirmed source and merchant resource validator rejects confirmation fields',
    )
  }
  {
    const id = await seed(),
      before = await inspect(id),
      r = await call('review', id),
      after = await inspect(id)
    assert.equal(r.body.results[0].outcome, 'review_only')
    assert.equal(r.body.results[0].productionAdmitted, false)
    assert.equal(after.binding.source, 'unconfirmed')
    assert.equal(after.binding.generation, before.binding.generation + 1)
    assert.equal(after.binding.review_block_number, '100')
    assert.equal(after.binding.block_hash, null)
    assert.equal(after.journal.at(-2).provenance, 'local_simulation')
    assert.equal(after.receipts, 0)
    pass(
      'valid mocked finalized observation is review-only; provenance and generation history persist without confirmed block fields',
    )
    const g = after.binding.generation
    assert.equal(
      (await call('review', id, { block: 99 })).body.results[0].outcome,
      'replay',
    )
    assert.equal((await inspect(id)).binding.generation, g)
    assert.equal(
      (await call('review', id, { block: 100 })).body.results[0].outcome,
      'replay',
    )
    pass(
      'older and identical observation replay cannot overwrite the review watermark or generation',
    )
    assert.equal(
      (await call('review', id, { block: 100, mode: 'conflict' })).body
        .results[0].outcome,
      'conflict',
    )
    const conflict = await inspect(id)
    assert.equal(
      conflict.binding.review_block_hash,
      after.binding.review_block_hash,
    )
    assert.equal(
      conflict.journal.filter((x) => x.outcome === 'conflict').length,
      1,
    )
    pass(
      'conflicting canonical hashes are preserved as conflict evidence rather than replacing the original',
    )
    assert.equal((await call('immutable', id)).body.rejected, true)
    pass('review and binding history is append-only in actual D1')
    assert.equal(
      (await call('review', id, { block: 101 })).body.results[0].outcome,
      'conflict',
    )
    assert.equal((await inspect(id)).binding.review_conflicted, 1)
    assert.equal((await inspect(id)).binding.review_block_number, '100')
    pass(
      'conflict quarantine survives newer blocks; there is no automatic resolution or confirmation',
    )
  }
  for (const mode of [
    'price-race',
    'aba',
    'owner-race',
    'binding-race',
    'binding-delete-aba',
  ]) {
    const id = await seed(),
      before = await inspect(id),
      result = await call('review', id, { mode }),
      after = await inspect(id)
    assert.equal(result.body.results[0].outcome, 'raced', mode)
    assert.equal(after.binding.review_block_number, null)
    assert.equal(
      after.journal.filter(
        (x) => x.kind === 'observation' && x.outcome === 'raced',
      ).length,
      1,
    )
    assert.ok(
      after.resource.payment_revision > before.resource.payment_revision ||
        after.binding.generation > before.binding.generation,
    )
    pass(
      mode +
        ' during async observation cannot commit a stale registry snapshot; history retains the race',
    )
  }
  {
    const id = await seed(),
      r = await call('review', id, { mode: 'concurrent' }),
      s = await inspect(id)
    assert.deepEqual(r.body.results.map((x) => x.outcome).sort(), [
      'raced',
      'review_only',
    ])
    assert.equal(s.binding.generation, 2)
    pass(
      'concurrent observations produce one atomic binding update and one recorded CAS loser',
    )
  }
  {
    const id = await seed(),
      before = await inspect(id)
    assert.equal((await call('review', id, { mode: 'fault' })).status, 503)
    await call('dropFault', id)
    const after = await inspect(id)
    assert.equal(after.binding.generation, before.binding.generation)
    assert.equal(after.binding.source, before.binding.source)
    assert.equal(after.journal.length, before.journal.length)
    assert.equal(
      (await call('review', id)).body.results[0].outcome,
      'review_only',
    )
    pass(
      'real SQLite interruption rolls journal/invalidation/watermark back atomically; subsequent retry recovers',
    )
  }
  {
    const id = await seed(),
      r = await call('payment', id, { mode: 'invalidate' }),
      s = await inspect(id)
    assert.equal(r.body.authorized, false)
    assert.equal(s.attempts[0].phase, 'verified')
    assert.equal(s.receipts, 0)
    pass(
      'an outstanding D1 payment snapshot loses authorization when binding generation/source changes; no settlement or protected response',
    )
  }
  {
    const id = await seed(),
      before = await inspect(id)
    assert.equal((await call('rollbackCounters', id)).body.rejected, 2)
    const after = await inspect(id)
    assert.equal(after.binding.generation, before.binding.generation)
    assert.equal(
      after.resource.payment_revision,
      before.resource.payment_revision,
    )
    pass(
      'D1 rejects resource-revision and binding-generation rollback independently of application code',
    )
  }
  for (const mode of [
    'identical',
    'changed-config',
    'changed-registry',
    'changed-owner',
  ]) {
    const id = await seed()
    await call('review', id)
    await call('review', id, { mode: 'conflict' })
    const conflict = await inspect(id)
    assert.equal((await call('recreate', id, { mode })).status, 200)
    const recreated = await inspect(id)
    assert.equal(recreated.binding.review_conflicted, 1)
    assert.equal(recreated.binding.source, 'unconfirmed')
    assert.ok(
      recreated.resource.payment_revision > conflict.resource.payment_revision,
    )
    for (const old of conflict.journal)
      assert.ok(
        recreated.journal.some(
          (x) => x.id === old.id && x.payload_json === old.payload_json,
        ),
      )
    for (const block of [99, 100, 101])
      assert.equal(
        (await call('review', id, { block })).body.results[0].outcome,
        'conflict',
      )
    assert.equal((await call('payment', id)).body.authorized, false)
    assert.equal((await inspect(id)).receipts, 0)
    assert.equal((await call('restoreSource', id)).body.rejected, true)
    assert.equal(
      (await call('restoreSource', id, { mode: 'source-only' })).body.rejected,
      true,
    )
    pass(
      'persistent conflict survives ' +
        mode +
        ' recreation and old/new observations; no authorization or source reset',
    )
  }
  {
    const id = await seed()
    assert.equal(
      (await call('payment', id, { mode: 'prepare' })).body.prepared,
      true,
    )
    await call('review', id)
    await call('review', id, { mode: 'conflict' })
    await call('recreate', id)
    const stale = await call('staleAttempt', id)
    assert.equal(stale.body.settlementClaim, false)
    assert.equal(stale.body.attempt.phase, 'verified')
    assert.equal((await inspect(id)).receipts, 0)
    pass(
      'a prepared authorization cannot claim settlement after conflict and binding recreation; persisted phase remains unchanged',
    )
  }
  {
    const id = await seed()
    await call('review', id)
    await call('review', id, { mode: 'conflict' })
    const before = await inspect(id)
    assert.equal((await call('recreate', id, { mode: 'fault' })).status, 503)
    const after = await inspect(id)
    assert.deepEqual(after.binding, before.binding)
    assert.equal(
      after.resource.payment_revision,
      before.resource.payment_revision,
    )
    assert.equal(after.journal.length, before.journal.length)
    assert.equal(after.receipts, before.receipts)
    pass(
      'database fault rolls deletion/recreation back atomically without losing quarantine, history or receipts',
    )
    const results = await Promise.all([
      call('review', id),
      call('recreate', id),
      call('review', id),
    ])
    for (const r of [results[0], results[2]])
      assert.ok(['raced', 'conflict'].includes(r.body.results[0].outcome))
    const concurrent = await inspect(id)
    assert.equal(concurrent.binding.review_conflicted, 1)
    assert.equal(concurrent.binding.source, 'unconfirmed')
    assert.equal((await call('payment', id)).body.authorized, false)
    pass(
      'concurrent review and atomic delete/reinsert never create an active conflict-free binding',
    )
  }
  {
    const id = await seed()
    await call('recreate', id)
    assert.equal((await inspect(id)).binding.review_conflicted, 0)
    assert.equal((await call('payment', id)).body.authorized, true)
    assert.equal(
      (await call('review', id)).body.results[0].outcome,
      'review_only',
    )
    pass(
      'different non-conflicted UUIDs under the same mock registry retain normal local-only operation',
    )
  }
  const metadata = join(root, '.wrangler/admission-production-meta.json')
  execFileSync(
    process.execPath,
    [
      join(root, 'node_modules/wrangler/bin/wrangler.js'),
      'pages',
      'functions',
      'build',
      '--outdir',
      join(root, '.wrangler/admission-production-build'),
      '--metafile',
      metadata,
    ],
    {
      cwd: root,
      env: { ...process.env, WRANGLER_SEND_METRICS: 'false' },
      stdio: 'pipe',
    },
  )
  const inputs = Object.keys(
    JSON.parse(await readFile(metadata, 'utf8')).inputs,
  )
  assert.equal(
    inputs.some((x) =>
      /tests\/|server\/sg05\/|server\/sg07\/|@x402|@coinbase/.test(x),
    ),
    false,
  )
  for (const path of [
    '/api/registry/confirm',
    '/api/registry-review',
    '/api/pay/x',
  ]) {
    const r = await fetch(runtime.origin + path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        REGISTRY_REVIEW_LOCAL_ONLY: 'yes',
      },
      body: JSON.stringify({ source: 'onchain_confirmed' }),
    })
    assert.equal(r.status, 404)
    assert.equal(r.headers.get('PAYMENT-RESPONSE'), null)
    await r.arrayBuffer()
  }
  pass(
    'public forged confirmation requests fail closed; production bundle excludes review capabilities and mock gateway',
  )
  console.log(
    `${count} registry-admission checks passed in native local Pages/workerd and D1. LOCAL SIMULATION ONLY; no Mainnet admission.`,
  )
} finally {
  await runtime.close()
  await rm(upgradeState, { recursive: true, force: true })
}
