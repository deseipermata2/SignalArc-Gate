# SG-07 — Registry observation review and durable D1 consistency

**SG-07 remains IN PROGRESS. Production launch and production registry admission remain BLOCKED.** This continuation implements an internal untrusted observation/review lifecycle, not Mainnet evidence admission. Every result has `productionAdmitted: false`. No RPC mock or database label can become verified Mainnet evidence through the new interface.

## Baseline and scope

Read-only inspection confirmed `/home/deseti213/projects/signalarc-gate`, `main`, HEAD **3433de2**, matching the owner's baseline. Only the six SG-02 through SG-07 review archives were initially untracked; they were preserved. No applicable AGENTS.md or canonical V2 roadmap/rules files were found locally or in applicable ancestors. The supplied restrictions govern; no official phase/checklist was marked complete.

Reviewed the existing SG-07 report/runbook/checklist, registry/RPC/facilitator modules, SG-05 registry/store/gateway, SQL migrations, actual SG-04 contract/getter ABI, native D1 harnesses and package scripts. The initial SG-07 reader and facilitator work was retained. No public route, deployment address, credential, real RPC, transaction signing/broadcast, funded wallet, settlement, spending, production migration, DNS change or Git mutation was introduced. New admission tests require no wallet/signature. Preserved regression suites retain their existing ephemeral local signing fixtures; they do not execute blockchain transactions.

## Trust boundary

`server/sg07/admission.ts` exposes `createRegistryReview(db, policy, source, rpc, clock)`. All capabilities/configuration are supplied by server code. It accepts a resource UUID, not a caller-provided observation, confirmation flag, wallet, price, block or RPC URL. It derives expectations from the persisted resource, merchant and binding. The normal Functions router imports none of these capabilities and has no submit/approve/confirm endpoint.

Only `local_simulation` and `untrusted_rpc` provenance with a bounded nonsecret source label are supported. Attempts to label a mock `onchain_confirmed` or `verified_mainnet` are rejected. A policy's expected code hash is only an observation pin, not proof that an owner approved a real deployment. There is no approved-deployment authority, production signer/observer attestation, approval constructor, environment enable flag or promotion function. **Those authorities are missing, not simulated.**

The existing reader validates Base chain 8453, native USDC, strict registry address and code-hash pin, finalized canonical block/hash/depth/freshness, original-owner UUID identity, current merchant owner, payout, exact atomic price, configuration commitment, version, enabled state and absence of a pending transfer. Wrong or unavailable values fail closed. The review module permits collecting observations while a binding is unconfirmed; this does not make that binding usable for payments.

Each observation records configured source/provenance, policy, resource/configuration expectations, captured resource revision/binding generation, validated candidate (if any), controlled failure code and per-RPC-method SHA-256 response digests or transport-failure markers. Structural bounds precede digesting; raw error diagnostics, credentials, upstream URLs, salt preimages and payment signatures are not stored. Digests record what was observed; they are not independent proofs or a substitute for retaining approved authoritative production evidence. Invalid-policy/provenance construction is rejected before an observation capability exists. Storage failures cannot promise that their own failed operation was journaled.

## Forward migration: 0004_sg07_registry_review.sql

Historical migrations 0001/0002/0003 are unchanged. The new migration adds only the minimum review state and one shared append-only journal:

| Change                                                | Purpose                                                                                                             |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Binding `review_block_number`, `review_block_hash`    | Untrusted review watermark, separate from confirmed block metadata                                                  |
| Binding `review_registry_address`, `review_code_hash` | Scope the watermark to the exact observed contract/code policy                                                      |
| Binding `review_conflicted`                           | Sticky conflict quarantine; later blocks cannot silently clear it                                                   |
| `registry_evidence_journal` + resource/time index     | Append observations, binding revisions and resource revisions with explicit provenance/outcome                      |
| Confirmation insert/update guards                     | Reject all new `source='onchain_confirmed'` writes; no runtime bypass                                               |
| Baseline history and quarantine                       | Record existing binding claims as untrusted database history, then demote any legacy confirmed label to unconfirmed |
| Revision/generation guards                            | Reject rollback/non-incrementing counter writes                                                                     |
| Namespace guard                                       | Reject mutation of an existing binding's UUID/original-owner/derived-ID identity                                    |
| Resource/merchant/binding history triggers            | Preserve changes and invalidate old payment snapshots, including owner changes and binding deletion/reinsertion     |
| Atomic review invalidation trigger                    | Journal outcome and binding invalidation/watermark advance commit or roll back together                             |

Journal rows cannot be updated or deleted through ordinary SQL. They deliberately have no cascading resource foreign key, preserving historical evidence when a binding/resource disappears. Database administrators capable of changing schema/triggers remain trusted; this is not a cryptographic audit log or protection against a compromised D1 administrator.

Existing generation remains monotonic within a binding incarnation. Delete/reinsert is retained for compatibility with the existing negative fixture and is journaled; it may start a new generation at 1, but both operations increment the resource revision. The authorization identity is the **resource revision plus binding generation**, not generation alone. This prevents an old observation/payment snapshot from matching after a delete/reinsert ABA. Original IDs/owners remain immutable within an incarnation; no ownership-transfer rebinding policy or automated merchant reassignment was invented.

Resource edits already increment payment revision. New history records those increments; a merchant identity change also increments its resources' revisions. Any surviving legacy confirmed binding is demoted on resource revision change. New confirmations are globally prohibited by this migration, so merchant edits cannot preserve/recreate an obsolete confirmation. Local simulation bindings remain usable only by the existing isolated gateway fixtures until reviewed/invalidated; no production authorization is inferred from that profile.

## Atomic review lifecycle

1. Capture resource/merchant/binding expectations in one prepared SELECT, retaining revision and generation.
2. Validate/rederive the server configuration and observe through the injected read-only reader. No public observation payload is ingested.
3. Insert one journal row with `INSERT ... SELECT CASE`, comparing live revision/generation and review watermarks **inside the D1 write**, not relying on a JavaScript precheck.
4. The insertion trigger invalidates the binding and, when appropriate, advances the review watermark in that transaction. A D1 batch returns the persisted outcome.

| Outcome                    | Durable behavior                                                                                                          |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| `review_only`              | Save valid untrusted candidate; advance review watermark; set source unconfirmed; increment generation                    |
| `rejected` / `rpc_failure` | Record controlled failure; invalidate the matching captured binding and increment generation; do not advance watermark    |
| `raced`                    | Preserve the losing observation; do not overwrite/invalidate a newer revision or generation                               |
| `replay`                   | Retain older/identical observation; leave watermark/generation unchanged                                                  |
| `conflict`                 | Preserve both conflicting candidates; keep original watermark, invalidate, increment generation and set sticky quarantine |

Block numbers are canonical decimal strings. Comparisons use length then lexical ordering, avoiding JavaScript floating point or SQLite 64-bit casts for chain heights. A different contract/code policy at an existing watermark is a conflict. Once conflicted, a later block remains a conflict: no automatic resolution exists. Future resolution requires separately reviewed authority and forward-compatible implementation, not clearing a flag by public request. History is append-only for both successes and rejections; raw provider errors are sanitized.

All SQL values use bound parameters; SQL identifiers and trigger definitions are fixed code. The actual SQLite transaction fault test aborts journal insertion after side-effect triggers may run and verifies complete rollback of journal, source, generation and watermark. On storage failure there is no fabricated success; retry uses current persisted state.

## Payment safety

SG-05 binds attempts to UUID/merchant, price/payee/native asset, requirements, snapshot hash, registry version/commitment, resource revision and binding generation. These semantics were retained; production payment code was not changed.

New native tests exercise the real `snapshot`/`PaymentStore` checks: missing/unconfirmed/rejected review state cannot authorize an attempt; generation/source invalidation prevents the old verified attempt from claiming settlement pending. Two additional SG-05 HTTP E2E tests exercise binding invalidation after challenge issuance: during facilitator verification it creates no settlement/receipt/content, and during upstream execution it denies content while retaining the already recorded **local simulated** settlement receipt and `fulfillment_failed` status. A registry problem does not erase settlement history or authorize charging again.

The isolated PaymentStore CAS probe prepares lifecycle rows directly; it is not a signature-verification test. The two SG-05 HTTP cases use the existing real local signatures and mock facilitator flow. No journal outcome writes a payment receipt, analytics success, confirmed block or protected payload. In the admission fixture, actual D1 receipt counts remain zero. Existing local-only gateway success continues to require its explicitly simulated provider and authoritative simulated settlement; the normal production route tree still excludes that gateway and all review modules.

## Local verification evidence

Node 22.22.2/npm 10.9.7, native Wrangler Pages/workerd 4.154.0 and local D1; existing Forge 1.5.1 with pinned Solidity 0.8.28. No tooling or dependency was installed.

| Command                                               | Actual result                                                                                     |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| `npm run build`                                       | PASS; existing Vite/ox worker_threads externalization warning remains                             |
| `npm run lint`                                        | PASS                                                                                              |
| `npm run format:check`                                | PASS                                                                                              |
| `npm run test:foundation`                             | PASS via aggregate, 17 checks including health and real D1 read/write/cleanup                     |
| `npm run test:compatibility`                          | PASS via aggregate, 14 checks including helper loading and unchanged health 200                   |
| `npm run test:sg03`                                   | PASS via aggregate, 14 checks                                                                     |
| `npm run test:sg05`                                   | PASS via aggregate, **90 checks**: previous 88 plus two binding-invalidated HTTP flows            |
| `npm run test:sg06`                                   | PASS via aggregate, 20 checks                                                                     |
| `npm run test:sg07`                                   | PASS via aggregate, 45 checks                                                                     |
| `npm run test:registry-admission`                     | PASS, **33 checks** in native local Pages/workerd and actual D1                                   |
| `npm test`                                            | PASS, **233 checks** (17 + 14 + 14 + 90 + 20 + 45 + 33), exit 0                                   |
| `npm run build:functions`                             | PASS; actual production metafile excludes tests, SG-05 gateway, SG-07 review and x402/CDP modules |
| `npm audit`                                           | FAIL exit 1, 5 high + 12 moderate affected entries                                                |
| `npm audit --omit=dev`                                | FAIL exit 1, 5 high affected entries                                                              |
| `forge fmt --check`, `forge build`, `forge test -vvv` | PASS, 47 tests, zero failed/skipped; existing lint notes/test-cast warnings retained              |
| `git diff --check`, `git status --short`              | Read-only inspection; no whitespace errors or Git mutation                                        |

The dedicated 33 checks cover missing/unconfirmed bindings; wrong chain/address/code/owner, pending transfer, price/payout/hash mismatch, stale/timeout/malformed/disabled observations; forged provenance and confirmation attempts; review-only state/provenance; replay, conflicting hashes and persistent quarantine; append-only history; price, disable/re-enable, merchant owner, binding update and binding delete/reinsert races; concurrent CAS winner/loser; real SQLite interruption/retry; payment snapshot rejection; revision/generation rollback guards; and forged public requests/actual production graph isolation. Their fixture uses exact loopback origin, explicit `REGISTRY_REVIEW_LOCAL_ONLY=yes`, local mode and native `miniflare.db` metadata checks. Global fixture fetch rejects network egress; RPC responses are in-process local simulations, without any real endpoint/fallback. The existing SG-07 suite separately verifies the injected transport and network isolation. No new private key or payment signature is needed by the admission suite.

Migration commands, isolated state only:

```text
npm run db:migrate:local -- --persist-to .wrangler/admission-migration-final
Local D1 migrations: 0001_sg03.sql, 0002_sg05.sql, 0003_sg06_reporting_indexes.sql, 0004_sg07_registry_review.sql
[repeat]
Local D1 migrations: already applied (checksums verified)
```

Earlier development failures were not counted as PASS: initial TypeScript batch row inference needed an explicit row type; a fixture initially inserted a duplicate merchant wallet and was corrected to reuse that fixture merchant. One early aggregate run restarted its test runtime after the new, still-draft migration had been edited, correctly failing checksum validation. The final migration was then frozen and verified against fresh isolated state; previous migrations were never changed. Final aggregate checks passed, including runtime interruption/restart and repeat checksum validation. Generated logs/metafiles/state are ignored under `.wrangler/`; no review archive was changed.

## Dependency status

Fresh audits still report **17 affected entries: 5 high/12 moderate**, production-only **5 high**. The existing CDP/SVM → older core/abitype/Zod 3 paths remain affected by GHSA-mrhx-c7xc-m3w5; lint tooling/minimatch paths remain affected by GHSA-g3hv-75wg-m249. No new fix evidence or valid compatible candidate emerged from these audits. The previously documented SVM/Solana Kit peer conflict was not forced, and the investigation/SDK graph was not repeated or changed. No lockfile edits, dependency overrides, force audit fix or advisory suppression occurred. Input bounds and isolated parsing are mitigations, not fixes. CI retains its failing full audit job and includes the new suite through `npm test`.

## Exact file inventory

Created:

- `migrations/0004_sg07_registry_review.sql`
- `server/sg07/admission.ts`
- `tests/registry-admission/handler.ts`
- `tests/registry-admission/run.mjs`
- `tests/registry-admission/tsconfig.json`
- `docs/SG-07_REGISTRY_ADMISSION_REPORT.md`

Modified:

- `package.json` — dedicated test command and aggregate inclusion.
- `tests/sg03/run.mjs`, `tests/sg06/run.mjs` — expect the forward migration.
- `tests/sg05/run.mjs` — forward migration expectation plus two real local gateway invalidation checks.
- `docs/SG-07_READINESS_REPORT.md`, `docs/RELEASE_CHECKLIST.md` — continuation evidence and still-blocked admission gate.

No historical migration, contract/ABI/compiler setting, production Functions file, auth/CRUD/dashboard implementation, SG-05 payment implementation, initial registry/RPC/facilitator adapter, historical completed-phase report, lockfile or Git metadata was changed.

## Remaining authority and owner decisions

**Production registry admission is disabled in code architecture, routing and database guards.** The local lifecycle does not establish an approved deployed registry, independently trusted provider/finality, canonical source/code identity, genuine owner/configuration observation or Mainnet payment proof. Those are still unavailable. A future implementation must bind explicit owner deployment/code approval to a real read authority, checkpoint canonical observations and reorg behavior, resolve conflicts under reviewed authority and perform production admission only after separate approval. It must deliberately replace the current confirmation prohibition through a reviewed forward change; no flag or request can bypass it now.

Review the new migration's baseline quarantine, immutable journal/storage growth, sticky conflict policy, revision/incarnation semantics and SQL trust assumptions before any future production migration. Journal growth is additional storage/write load; no retention deletion, global rate limiter, production capacity measurement or paid entitlement is claimed. Server database administrators remain an authority boundary.

Other launch gates remain: relevant dependency remediation, compiler/artifact review, actual registry deployment/verification, live CDP authentication/permissions/evidence, canonical settlement reconciliation, production clock, connection-safe upstream transport, abuse/observability controls, real D1 backups/binding and TLS/domain verification. Existing non-executing launch/runbook approvals remain mandatory. No infrastructure or live operation is requested or authorized by this report.

**Verdict: local observation/consistency controls PASS for review; production admission and launch BLOCKED. SG-07 remains IN PROGRESS.** Stop here for owner/ChatGPT review; no next phase is started.

## Persistent quarantine correction — migration 0005

The earlier row-local persistence claim was incomplete. Independent review found that `registry_conflict_sticky` in migration 0004 guarded UPDATE only. Deleting the binding removed that flag, and inserting a replacement defaulted it to zero. The journal still contained the conflict, but the review CASE checked only the active flag. Existing revision checks protected old payment snapshots, yet did not prevent a new observation from treating the replacement as conflict-free. The original 33-check suite covered sticky updates and unconflicted delete/reinsert races separately; it missed this combination after a conflict.

### Remediation and identity scope

`0005_sg07_persistent_quarantine.sql` is a new **forward migration**. Files 0001 through 0004 were not changed; their pre-fix SHA-256 digests were checked after implementation. No new table, dependency, credential, route or resolution API was introduced.

The immutable observation journal is now the durable unresolved-conflict gate. A partial index selects `kind='observation' AND outcome='conflict'` by server-issued resource UUID. This deliberately quarantines the **lifetime application resource**, across binding incarnations, owner/configuration revisions and registry/code-policy changes. The original owner-namespaced onchain ID, registry/code policy, candidate and provenance remain in the unchanged journal for future trusted resolution. Changing those fields is not resolution authority. Different UUIDs under the same registry are not quarantined by another resource's history. Resource UUIDs are server-generated and cannot be chosen/rewritten through merchant CRUD; privileged database/schema tampering remains outside this guarantee.

The migration:

- Preserves legacy `review_conflicted=1` flags lacking observation history as explicit `database_history` / `quarantine_flag_backfill` conflict records. These record an existing flag, not a fabricated canonical-chain observation or payment. `productionAdmitted` remains false.
- Repairs active rows whose historical conflict survived but whose recreated flag was reset. Repair sets source unconfirmed and flag 1; existing generation/history triggers invalidate obsolete snapshots.
- Atomically enforces the same state after every binding INSERT when unresolved history exists, including a default-zero replacement. There is no externally visible committed conflict-free replacement window.
- Rejects UPDATE attempts to clear the flag **or** restore a payment-eligible source, even if the flag remains 1. This keeps existing SG-05 source/CAS checks fail-closed without changing settlement semantics.
- Invalidates a matching active binding whenever a conflict journal row arrives, regardless of a stale row-local flag. Trigger conditions avoid redundant invalidation when already quarantined; safety does not depend on trigger ordering.

`createRegistryReview` independently queries historical conflict existence inside its atomic INSERT/CASE, after revision/generation race checks and before failure/replay/watermark handling. A historical conflict yields `conflict` even for old or malformed later observations. That outcome means **existing quarantine remains unresolved**, not that every failed RPC represents a new chain fork; the actual candidate/error/digests remain in the payload. A concurrent revision change may still be recorded as `raced`, while the pre-existing conflict continues enforcing quarantine.

No old journal row, selected watermark or receipt is deleted, altered or fabricated. Migration 0005 does not restore a preferred block after recreation or select one side of a conflict. No clear/reset/resolution operation exists. Future resolution requires reviewed trusted authority and an explicit forward-compatible design retaining the old evidence; a source flag, new owner, new registry or merchant request is insufficient.

### Adversarial native evidence

The dedicated suite now passes **43 checks** (previously 33). Its upgrade stage runs actual local workerd/D1 with migrations through 0004, creates a conflict, deletes/reinserts the binding and observes flag 0 with the old conflict still present. It then restarts on the same isolated local database, applies **only 0005**, verifies repaired quarantine and unchanged historical rows, and repeats migrations with digests verified. The updated review implementation is used in both stages; the pre-005 reproduction specifically proves the database flag loss, while the previous source predicate explains the corresponding review bypass.

New assertions cover:

- Repair of the already-recreated binding and backfill of a legacy flag without observation history.
- Identical, changed configuration, changed registry and changed current owner recreations, retaining flag 1/source unconfirmed and all old journal payloads.
- Old, identical-height and newer observations remaining conflicted after recreation; direct flag reset and source-only restoration both rejected.
- An existing prepared local PaymentStore snapshot unable to claim settlement pending after conflict/recreation; persisted phase unchanged and no receipt created. This is a CAS probe, not a signature-verification claim.
- A real SQLite fault after deletion and during insertion rolling the entire transaction back: binding, revision, journal and receipt counts remain unchanged.
- Concurrent reviews and atomic deletion/reinsertion producing only conflict/race outcomes and a quarantined final binding.
- Normal local-only operation for another non-conflicted UUID under the same mock registry, plus preserved public-confirmation rejection and production bundle isolation tests.

Existing SG-05 HTTP tests continue to deny content on registry invalidation and retain already persisted **local simulated** receipts after delivery failure. The fix introduces no receipt mutation or transfer. Preventing a new settlement claim is not cancellation of an already-started external effect; distributed settlement/delivery limitations and unknown-outcome reconciliation gates remain unchanged.

### Current verification

| Command                                                      | Result                                                                               |
| ------------------------------------------------------------ | ------------------------------------------------------------------------------------ |
| `npm run test:registry-admission`                            | PASS — 43 native local workerd/D1 checks                                             |
| `npm test`                                                   | PASS — **243 checks** (17 + 14 + 14 + 90 + 20 + 45 + 43), exit 0                     |
| `npm run build`, `npm run lint`, `npm run build:functions`   | PASS                                                                                 |
| `npm run format:check`, `git diff --check`                   | PASS — final repository formatting and whitespace checks                             |
| `forge fmt --check`, `forge build`, `forge test -vvv`        | PASS — 47 tests, 0 failed/skipped; existing compiler/lint notes retained             |
| `npm audit`                                                  | FAIL exit 1 — 17 affected entries, 5 high / 12 moderate                              |
| `npm audit --omit=dev`                                       | FAIL exit 1 — 5 high affected entries                                                |
| Forward local migration and repeat                           | Native upgrade applies only 0005 over existing 0004 state; repeat verifies checksums |
| `sha256sum -c .wrangler/quarantine-migrations-before.sha256` | PASS — migrations 0001, 0002, 0003, 0004 unchanged                                   |

An initial adversarial run failed in the ownership-change fixture because its chosen wallet collided with another fixture merchant's unique wallet. The fixture was corrected to use a distinct unfunded address; no production guard or assertion was weakened. The preceding 42-check run passed before adding the legacy-flag backfill assertion. These checkpoints are not the final expanded count. Logs/metafiles/state are local ignored artifacts under `.wrangler/`.

### Exact files for this correction

Created: `migrations/0005_sg07_persistent_quarantine.sql`.

Modified: `server/sg07/admission.ts`; `tests/registry-admission/handler.ts`; `tests/registry-admission/run.mjs`; `tests/sg03/run.mjs`, `tests/sg05/run.mjs`, `tests/sg06/run.mjs` (new migration expectations only in these three runners); `docs/SG-07_REGISTRY_ADMISSION_REPORT.md`; `docs/SG-07_READINESS_REPORT.md`; `docs/RELEASE_CHECKLIST.md`.

The preceding local admission work, including package scripts and migration 0004, remains preserved and uncommitted. HEAD remains `3433de2`. Seven review archives are present (including the additional admission-review archive); none was modified or staged. No dependency/lockfile, production Functions, contract/compiler, payment implementation, credential, DNS, remote D1 or external infrastructure was changed by this correction.

### Remaining boundaries

The journal is protected by SQL triggers, not cryptographically tamper-proof against administrators who can replace schema/triggers. Quarantine is intentionally conservative and has no automatic resolution or expiry, including after legitimate owner/registry rotation. Storage/rate/retention limits remain release concerns. A future trusted resolution policy and genuine approved deployment/provider/finality authority are still absent. Public payments remain disabled; local mock provenance is never promoted to Mainnet evidence.

Dependency findings remain unresolved and unsuppressed; this fix does not remediate Zod/minimatch or approve upstream peer changes. All existing registry, compiler, facilitator, reconciliation, clock, upstream transport, operational and owner-authorization launch gates remain. **SG-07 stays IN PROGRESS; production/Mainnet launch remains BLOCKED.** No deployment, transaction broadcast/signing, live RPC/CDP call, spending, DNS change, Git mutation or next-phase work occurred.

Final correction verification: `npm test` exited 0 with **243 checks**, including all **43 registry-admission checks**. Final build, ESLint, format and Functions build exited 0; Foundry retained 47 passing tests. The standalone local helper applied all five migrations and then reported `already applied (checksums verified)`. Read-only Git status remains at HEAD `3433de2` with the pre-existing admission work, the fix-specific files above and seven preserved archives. Audits exit 1 as documented; no security finding was suppressed.
