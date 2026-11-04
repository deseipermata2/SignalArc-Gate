# SG-07 comprehensive remediation and deployment-readiness review

**Verdict: BLOCKED. SG-07 IN PROGRESS.** The safe local changes below are ready for source review. Production payments and real upstream fulfillment remain disabled. Manual registry deployment is **not** the only remaining step: production observation/admission orchestration, recovery, trusted clock/operational policy, dependency remediation and a connection-safe approved upstream design remain required. No independent security audit or live settlement is claimed.

## Baseline and preserved authority

Read-only inspection confirmed `main` at owner checkpoint **08943d9**; the working tree initially contained only twelve untracked review archives. No applicable AGENTS.md or canonical V2 rules/roadmap file was found in the project/applicable ancestors; supplied constraints govern. Existing SG-07 reports, native Functions/auth/dashboard, D1 migrations, registry contract/test harnesses, manifests and CI were inspected. All archives and existing records were preserved. No canonical checklist was changed.

The owner reports the production control plane/domain smoke test already passed. Local `wrangler.jsonc` contains `APP_ORIGIN=https://gate.signalarc.fun`, `BASE_CHAIN_ID=8453`, project `signalarc-gate` and the genuine existing production `SIGNALARC_DB` binding. That file is unchanged. No DNS, public-domain smoke test, Cloudflare deployment, remote D1 or account operation was repeated. Older documentation's statements that domain/database setup has not occurred are explicitly marked historical/superseded; owner evidence is distinguished from independent checks here.

## Issue-by-issue disposition

| Gate / issue                                | Root cause and local action                                                                                                                                                                                   | Current disposition                                                                                                                                                                                                                                                             |
| ------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency vulnerabilities                  | Latest supported CDP still requires Zod 3; patched SVM requires incompatible Kit peers; current lint parents require minimatch 10. Audits, metadata, entry-point resolution and exact public graphs rechecked | BLOCKED upstream dependency graph; no cosmetic removal, override or downgrade                                                                                                                                                                                                   |
| Compiler pinned at 0.8.28                   | Patched official 0.8.38 was installed but the real project still selected 0.8.28                                                                                                                              | Pin/pragmas updated to 0.8.38; ABI/storage/initcode/runtime reproduced identically; owner review still required                                                                                                                                                                 |
| Artifact identity ambiguity                 | Historical `ebaf…` digest hashes newline-terminated hex text, not runtime bytes                                                                                                                               | Record explicitly separates raw SHA-256, hex-line SHA-256 and Ethereum Keccak; fresh isolated-build check added                                                                                                                                                                 |
| Resource/registry authorization             | Existing review-only admission, revision/generation CAS and lifetime conflict quarantine already pass; expectation helper did not explicitly include conflict journal/code-hash gates                         | Added independent journal/quarantine/approved code-hash predicates; production confirmation stays disabled                                                                                                                                                                      |
| Unbounded first clock read / clock rollback | RPC/registry start-clock reads preceded their timeout, and payment clock wrappers had no own timeout                                                                                                          | Start reads moved inside operation timers, monotonic capability clocks bounded; rollback, hang and late observations deny progress                                                                                                                                              |
| RPC failure cleanup                         | Redirect-followed results were not explicitly denied; non-200 stream cancellation was awaited                                                                                                                 | Reject redirected responses and do not await potentially hanging cancellation; injected read methods remain allowlisted                                                                                                                                                         |
| Independent payment observation absent      | Facilitator result alone cannot establish nonce consumption, canonical finality or signed transaction contents                                                                                                | Added a strict read-only direct-USDC observer with local cryptographic/RPC tests; no receipt admission or fulfillment authority                                                                                                                                                 |
| Provider metadata leakage risk              | Local receipt serialization forwarded arbitrary returned `extra` fields                                                                                                                                       | Project only canonical payment fields plus recognized asset/recipient and local provenance on both write and recovered read; validate the stored receipt against the attempt before upstream access; diagnostic/bearer sentinels are excluded and failures never become success |
| API abuse bounds incomplete                 | Auth/resource/reporting had input bounds and nonce throttles but no shared application request budget                                                                                                         | New single-row D1 CAS budget, 600/minute and 20,000/day; native concurrent and real API denial tests; no client override                                                                                                                                                        |
| Slow request bodies / excessive collections | SG-03 JSON reader could await a body indefinitely and did not cap collection/node counts                                                                                                                      | 5-second body deadline, nonblocking cancellation, strict Content-Length, 64 entries/collection, 1,024 nodes, existing depth/16 KiB limits retained                                                                                                                              |
| Upstream SSRF                               | Ordinary Fetch/hostname/DNS validation cannot prove the actual connected peer is safe                                                                                                                         | Retain deny-all; no real upstream transport enabled; narrowed service-binding proposal requires owner scope/infrastructure approval                                                                                                                                             |
| Operational recovery                        | Real D1/chain/facilitator effects are not one atomic transaction                                                                                                                                              | Existing unknown/delivery-failed handling preserved; operator policy and reviewed production implementation remain blockers                                                                                                                                                     |
| CI / release evidence                       | No fresh-build artifact record check or reusable browser/Functions graph guard; production-only audit not separately run                                                                                      | Added both checks and production-only audit execution after a failed full audit; failure remains mandatory, no continue-on-error                                                                                                                                                |

The new budget is a **global application ceiling**, not fair per-client protection, an edge WAF, a security clock, or a guarantee that an attack cannot exhaust the shared quota. It uses one SQL conditional UPSERT, one fixed row, bound integer windows and no IP/cookie/wallet identifiers. Eight simultaneous fixture calls with one remaining permit produce exactly one acceptance and seven 429s. Backward time cannot reset either window; day rollover is explicit. Database faults do not grant admission. Health bypasses this budget so it remains available during API quota exhaustion/missing migrations. The actual API returns 429 despite forged budget headers.

The numerical limits are explicit reviewable policy defaults, **not observed traffic, capacity or billing figures**. Each API admission adds a D1 write/check; rejected/hostile ingress still consumes runtime/database resources. Per-identity fairness, edge throttling, production load tests, retention, alerts and budget ownership remain approval/engineering work. This control does not replace Cloudflare quotas or eliminate denial-of-service risk.

## Dependency investigation and exact runtime exposure

Fresh full audit: **17 affected entries (5 high, 12 moderate)**; production-only: **5 high**. Both exit 1. Root advisories remain [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) and [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249), propagated through dependants rather than seventeen independent flaws.

Installed versions remain CDP **1.60.0**, core/EVM/extensions **2.29.0**, SVM/nested core **2.28.0**, Kit **5.5.1**, root Zod **3.25.76**, patched Foundation Zod **4.6.7**, minimatch **10.2.6**, ESLint **10.13.0**, typescript-eslint **8.72.1**, viem **2.57.13**. `npm ls` exits 0; `npm explain` and current `npm view` declarations confirm:

- Latest CDP 1.60.0 requires Zod `^3.25.76`, exact abitype 1.0.6 with a Zod-3 peer, Kit `^5.5.1`, token/system program peers compatible with Kit 5. The newest stable Zod 3 is still 3.25.76; the advisory's fixed 4.6.6/4.6.7 does not satisfy those requirements.
- Current SVM 2.28.0 requires nested core ~2.28.0. Latest SVM 2.29.0 requires Kit >=8 and newer program packages, conflicting with the CDP Kit line. A superficially suggested SVM bump is not a supported secure combined install.
- Latest ESLint 10.14.0, config-array 0.23.5 and TypeScript-eslint 8.72.1 still constrain minimatch 10. Patched minimatch 11 is outside these ranges.
- CDP exposes only the public `./x402` barrel for this helper, not a documented facilitator-only subpath. In an isolated temporary package tree, **actual Wrangler bundling without SVM exits 1 with SVM resolution errors; restoring SVM exits 0**. The real project dependencies were not removed. Private imports/manual reimplementation or repackaging would require separate review; moving vulnerable packages to dev-only merely to change audit counts was not done.

Official manifests: [CDP](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0), [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0), [ESLint 10.14.0](https://registry.npmjs.org/eslint/10.14.0), [config-array](https://registry.npmjs.org/@eslint/config-array/0.23.5), [Zod releases](https://registry.npmjs.org/zod). No supported clean combination was found. The minimal alternatives are upstream-supported CDP Zod/Kit remediation and minimatch parent releases, or a separately reviewed official facilitator-only SDK boundary—not an unapproved facilitator/provider replacement.

`check:bundle-boundary` captures an actual Wrangler production metafile and configured Vite production module/chunk graph. Current results: **462 Functions inputs, 1,780 browser inputs and two browser chunks**, with no SG-05/07 payment/test modules, CDP/x402, Zod or minimatch inputs. The ordinary API now includes the SG-03 budget. This is strong current artifact-composition evidence, **not remediation of installed vulnerabilities or approval for future SDK imports**. The actual public CDP helper still bundles/loads in the existing native compatibility suite. Manifest dependency versions and package-lock are unchanged; `npm ci` passes reproducibly.

## Solidity compiler and immutable registry

All Solidity source/test pragmas and `contracts/foundry.toml` now select **0.8.38+commit.1835d247**. The installed Linux compiler SHA-256 matches the [official compiler manifest](https://raw.githubusercontent.com/ethereum/solc-bin/gh-pages/linux-amd64/list.json): **65c3180a336eabb6bdc4bbd49cc405aeb233976964ae6c11fba2a6c8be8f3243**. The [current official bug list](https://raw.githubusercontent.com/ethereum/solidity/develop/docs/bugs.json) contains no affected version range including 0.8.38; SOL-2026-7 is fixed there. This is a current advisory assessment, not proof that no undiscovered compiler bug exists. The old legacy/Yul-disabled settings mitigated some old issues but did not justify retaining an old compiler indefinitely.

Keep Cancun, optimizer 200, legacy codegen and Yul disabled, no bytecode metadata hash/CBOR and no libraries. Direct artifact comparison with a freshly built 0.8.28 baseline confirms identical **ABI, full storage layout, creation bytecode and runtime bytecode**. Contract behavior is unchanged: four-slot owner/version/enabled, payout/price, hash and pending-owner storage; no external calls, admin/proxy, token operations, escrow, settlement or payable receiver. Stable owner-namespaced IDs, version CAS, disable and two-step transfer remain covered by all **47 unit/fuzz/invariant tests**.

The reproducible [release record](CONTRACT_RELEASE.json) records source/configuration/compiler/settings, ABI/layout, byte lengths and hashes; its production approval field remains false. `check:contract-release` recompiles in a fresh isolated temporary project and compares the record, avoiding stale cache attribution. It does not regenerate the record or deploy.

| Artifact                                                       | Actual evidence                                                                             |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------- |
| Runtime size                                                   | 4,172 bytes                                                                                 |
| Initcode size                                                  | 4,239 bytes                                                                                 |
| Raw runtime SHA-256                                            | `ce6f21f57d87051c51ffbfb05330981574d1e516a932aa3b1a95cc6bed13ef45`                          |
| Runtime Ethereum Keccak-256                                    | `0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df`                        |
| SHA-256 of `0x` hex line plus newline                          | `ebaf47794b9dd9041d96904ab79daab2ff765aec496df943ec6d482757f9d31f` — matches owner evidence |
| Initcode raw SHA-256                                           | `bffa7d779dc4b161506e4003864037f34ff1357303c58373b58ea124ea971726`                          |
| Local deployment gas                                           | 955,984                                                                                     |
| Local register / update / disable gas, max in exercised report | 97,763 / 44,132 / 30,611                                                                    |

Gas values are local execution measurements, include the exercised test paths (including reverted calls in aggregate distributions), and are **not Base Mainnet fee quotations**. The [manual WSL guide](SG-07_MANUAL_CONTRACT_DEPLOYMENT.md) records compiler/bytecode/secure signer/chain/gas-budget/source-verification checkpoints. No deployment script or funded signer was created. No deployed address is invented. Contract technical reproducibility is locally established; source review, approved artifact/signer/budget and authorized execution remain separate.

## Registry, independent settlement observation and admission

Existing finalized/hash-pinned registry reads, approved runtime-code hash, original/current owner, payout, atomic price, pending transfer, version/hash, freshness and canonical rechecks remain. D1 admission still appends untrusted observations, uses live generation/revision CAS and lifetime conflict quarantine, and **cannot write new onchain_confirmed bindings**. The expectation helper now explicitly rejects quarantine history/flags and an absent/mismatched reviewed runtime-code hash, rather than treating a source flag as adequate. Historical migrations 0001–0005 are byte-for-byte unchanged.

A further local review found that finalized-only configuration comparison could overlook a disable, transfer, pending nomination, price/payout/version/hash change already visible in the head. The reader now requires a hash-pinned head getter to match the finalized getter byte-for-byte, and rechecks the canonical identity/timestamp of **both** blocks. Nine added native cases reject those head mismatches, head reorgs and future-dated heads. The positive registry path now performs nine required RPC reads instead of seven. The registry-admission mock now returns consistent numbered head metadata for this additional recheck; old quarantine/history assertions remain intact. This observes known changes, not mempool intent or future state: a change after the final sample is still a distributed consistency window, not an atomic chain/D1/response transaction.

The new settlement observer is **read-only and unconnected to production persistence/fulfillment**. Its only output is a source-labelled `rpc_observation_only` with `productionAdmitted=false`. It has no default RPC/fetch, credentials, status API, signing service or retry. A separately server-controlled read transport/policy must be injected. Tests install a global egress denial and only simulated RPC returns are used.

For the deliberately conservative direct-USDC subset it verifies:

1. Base chain 8453, native USDC, explicit finalized policy, minimum confirmation depth and maximum age, bounded/monotonic clock and total deadline.
2. Successful receipt with exact transaction hash, canonical numbered block/hash and sufficient finalized depth.
3. Same transaction/receipt block, caller and token target, zero ETH value, supported transferWithAuthorization/receiveWithAuthorization calldata (bytes or classic v/r/s signature forms).
4. Exact payer/recipient/atomic value and authorization validity at inclusion; genuine EIP-712 recovery under Base native-USDC domain. For receiveWithAuthorization, caller must match recipient.
5. Derived network/token/payer/nonce identity and exact canonical authorization/signature fingerprint equal the existing immutable attempt fields (including validity bounds); no raw authorization signature is returned or persisted.
6. Exactly one matching token Transfer and AuthorizationUsed event, correct emitter/transaction/block, unique log indices and no removed logs.
7. authorizationState at the finalized canonical block is true and both receipt/finality blocks still match after the observation.

The [issuer EIP-3009 implementation](https://github.com/circlefin/stablecoin-evm/blob/master/contracts/v2/EIP3009.sol) supplies the event/nonce semantics. A consumed nonce alone could be cancellation; the successful supported calldata, Transfer and AuthorizationUsed checks are jointly required. Hashes or success booleans alone cannot pass. Local positive tests use genuine ephemeral unfunded EIP-712 signatures; all chain receipts/logs/blocks remain **LOCAL SIMULATION ONLY**, not actual chain proof.

Important limits: **routed/multicall/unknown transaction shapes fail closed**, even if an actual future CDP implementation uses them. Approve and prove the real CDP execution shape before widening this subset. A malicious RPC can lie about inclusion/canonicality despite coherent data; this adapter is not a consensus light client/state proof or independent evidence authority. Provider trust, deployed registry provenance, actual CDP behavior and the production admission/reconciliation policy are missing. No observation is promoted into a receipt or content release. A trusted durable admission journal/writer and production orchestration still require reviewed engineering after those policy decisions.

The shared receipt projection runs at persistence and at response release, so old stored provider fields cannot leak through recovery. Bounded recovered JSON must match the attempt payer/network/amount/recipient before any upstream call; projection preserves the success flag rather than creating success.

Existing SG-05 settlement semantics are preserved: durable unique authorization claim, no content after verification alone, one settlement initiator, ambiguous results pending/unknown, no automatic resubmission, atomic local receipt/event persistence, final resource-revision gates and retained paid-but-unfulfilled evidence. SDK direct-client calls remain distinct from its higher-level automatic pending retry helper. Real CDP JWT/authentication, redirect/raw-body boundaries, durable idempotency contract and authoritative status/recovery were not proven by mocks. `fulfilled` remains a release claim, not acknowledgement of buyer delivery. No automatic refund or replay delivery was added without approved recovery policy.

## Upstream and operational readiness

[Cloudflare Request semantics](https://developers.cloudflare.com/workers/runtime-apis/request/) and [known issues](https://developers.cloudflare.com/workers/platform/known-issues/) still do not give ordinary merchant-hostname Fetch a peer-IP pinning guarantee. A hostname allowlist, DNS precheck, CNAME or resolveOverride does not close that gap. Production denies every upstream URL; no real connection was attempted. Existing pre-charge eligibility, redirect denial, fresh header construction, streamed byte/JSON bounds, cache isolation, deadline and stale-configuration checks remain tested.

The smallest proposed alternative is a **fixed named service binding to an owner-reviewed JSON handler that performs no merchant-selected downstream fetch**, with a versioned resource/merchant manifest, D1 authorization/policy revision checks, bounded concurrency and no incoming buyer credentials. This narrows product/connection scope and requires a concrete owner architecture/infrastructure decision. It was not silently implemented, configured or deployed. Arbitrary third-party HTTPS still requires a demonstrably connection-safe transport. This subtask stops at that explicit boundary; all other local remediation continued.

Authentication/origin/CSRF/session behavior remains tested through the actual native runtime and Chromium, with HttpOnly/Secure/SameSite cookies, exact origin/domain/Base checks and hashed sessions. The added body limits and budget preserve merchant ownership filters. Errors remain bounded; no raw signatures, cookies, keys or SQL values are logged by new code. Actual production abuse limits, alert destinations, incident ownership, retention and load capacity are not inferred from a local run.

[Current D1 limits](https://developers.cloudflare.com/d1/platform/limits/) distinguish Free 500 MB/database, 50 queries/invocation and **7-day Time Travel** from Paid retention; [Time Travel documentation](https://developers.cloudflare.com/d1/reference/time-travel/) does not prove this account's backups/restore behavior. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) likewise do not certify capacity or replace edge security controls. No paid feature was introduced. Account plan, real CPU/query/cost envelope and alerts require owner verification.

Close payment exposure **before any future restore**. A D1 rollback can lose later authorization claims or conflict quarantine; do not reopen from an old snapshot or retry charges. Preserve/replay financial and registry-conflict evidence, quarantine restored resources, independently reconcile onchain nonce/receipts and pending submissions, and approve a safe checkpoint before reopening. Append-only quarantine/payment history must not be deleted as retention cleanup. A production recovery/retention job is not implemented because its evidence authority, policy and operator are not approved.

## Forward migration and rollout boundary

Only **0006_sg07_api_budget.sql** is new: one fixed-row budget table; no merchant/payment/registry schema rewrite or data backfill. SHA-256: `dabcb245bc2e24b72e4da293aa2e386b0d4b8c6e8e5e52b49fcf3df887477029`. Local native migration application and repeat/checksum checks pass, including the standalone `db:migrate:local -- --persist-to <fresh local directory>` helper. Historical checksums were compared with HEAD and remain unchanged. No remote migration or production data was touched.

The owner must separately review and apply 0006 to the genuine production database **before publishing code that requires it**. The migration is additive and the previous app ignores the table; absence fails closed with a sanitized 503 for affected APIs, while health remains 200. A code rollback must preserve all payment/registry history; it must not reset authorization or conflict records. Do not create a second remote database or change the existing binding.

## Verification evidence and failures

Environment: Node 22.22.2, npm 10.9.7, Wrangler 4.154.0, Forge 1.5.1-stable. The existing official compilers were used; no system tooling was installed. Raw local logs/graphs are diagnostic artifacts under ignored `.wrangler/remediation-*`, not production records. The dedicated native release-security command is reproducible from the repository and included in `npm test`. The standalone local migration helper applied all six files and then reported already applied with checksums verified, both exit 0.

The new suite covers successful bytes/classic/receive EIP-3009 recovery, wrong chain/token/identity/payer/payee/amount, invalid signature, ETH value, wrong signature domain, reverted/missing transaction, missing/duplicate/removed/mismatched logs, nonce not consumed, insufficient finality, stale/reorged blocks, incorrect persisted fingerprint, malformed clock, RPC error/hang, concurrent/day/backward-window quota behavior, actual SQL abort, actual public-API 429 despite forged headers, slow/malformed/excessive body structure and production route/bundle isolation. Positive observer cases persist **zero payment receipts**; mocked blocks/receipts never become admitted evidence. Existing 325 groups retain replay, crash/reload, settlement ambiguity, paid-but-unfulfilled, SIWE/CSRF/ownership, browser and quarantine coverage.

Intermediate development failures were corrected rather than hidden: an initial edit command used a doubled contracts path before changing files; the normal compiler commands were rerun with verified 0.8.38 metadata. The official compiler binary host returned HTTP 403, so its official GitHub solc-bin manifest mirror was used and matched the installed binary exactly. An initial new RPC count asserted nine instead of the eight actual required reads; the assertion now matches the explicit sequence. New crypto fixture address types/normalization and receive-signature selection initially rejected expected success; the fixture now uses validated lowercase identity hashing and distinct genuine message signatures. One aggregate failed because an existing exact upgrade-list assertion omitted 0006; it now expects the additive file while retaining every old migration/checksum assertion. No negative security assertion or audit gate was disabled.

A shell cleanup command was rejected by the local execution policy before it ran; the migration helper was instead run through an owned, freshly allocated Node temporary directory with constrained cleanup. No unrelated directory or archive was removed. Subsequent migration first/repeat checks both succeeded.

CI retains least-privilege read permissions, pinned actions, build/lint/format/native tests/Foundry and failing audits. It now checks a fresh contract artifact and public bundle graph, runs `forge build --sizes`, and runs the production-only audit even when the full audit fails (`if: !cancelled()`, **not** continue-on-error). Hosted GitHub CI was not invoked and is not claimed green; dependency-audit remains failing.

## Exact changed-file inventory

- `.github/workflows/ci.yml`
- `README.md`
- `contracts/foundry.toml`
- `contracts/src/EndpointRegistry.sol`
- `contracts/test/EndpointRegistry.invariant.t.sol`
- `contracts/test/EndpointRegistry.t.sol`
- `contracts/test/TestSupport.sol`
- `docs/ENVIRONMENT.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/SG-07_LAUNCH_RUNBOOK.md`
- `docs/SG-07_READINESS_REPORT.md`
- `package.json`
- `server/sg03/api.ts`
- `server/sg03/http.ts`
- `server/sg05/clock.ts`
- `server/sg05/gateway.ts`
- `server/sg05/protocol.ts`
- `server/sg05/store.ts`
- `server/sg07/registry.ts`
- `server/sg07/rpc.ts`
- `tests/registry-admission/handler.ts`
- `tests/registry-admission/run.mjs`
- `tests/sg03/run.mjs`
- `tests/sg05/run.mjs`
- `tests/sg06/run.mjs`
- `tests/sg07/handler.ts`
- `tests/sg07/run.mjs`
- `docs/CONTRACT_RELEASE.json`
- `docs/SG-07_MANUAL_CONTRACT_DEPLOYMENT.md`
- `docs/SG-07_REMEDIATION_REPORT.md`
- `migrations/0006_sg07_api_budget.sql`
- `scripts/contract-release.mjs`
- `scripts/dependency-exposure.mjs`
- `server/sg03/budget.ts`
- `server/sg07/settlement-evidence.ts`
- `tests/release-security/handler.ts`
- `tests/release-security/run.mjs`
- `tests/release-security/tsconfig.json`

## Final command results

Final complete aggregate: **390 application groups** = 17 foundation + 14 compatibility + 14 SG-03 + 122 SG-05 + 20 SG-06 + 72 SG-07 + 43 registry-admission + 32 upstream-security + **56 release-security**. Existing suites were not replaced. Individual suite commands ran as the actual `npm run test:*` subprocesses of `npm test`; the new suite also ran separately. Chromium desktop/mobile checks, genuine local signature verification, local D1 writes/CAS/faults and process-restart tests remain included. All successful payments in those suites are explicitly local simulations; zero live payments are established.

| Command                                                                        | Final exit | Evidence                                                                           |
| ------------------------------------------------------------------------------ | ---------- | ---------------------------------------------------------------------------------- |
| `npm ci`                                                                       | 0          | Clean locked install, no forced peers; audit warnings remain visible               |
| `npm run build`                                                                | 0          | TypeScript/Vite production build                                                   |
| `npm run lint`                                                                 | 0          | Full ESLint                                                                        |
| `npm run format:check`                                                         | 0          | Full repository formatting                                                         |
| `npm test`                                                                     | 0          | 390 groups across nine suites                                                      |
| `npm run test:release-security`                                                | 0          | 56 native workerd/D1 groups separately                                             |
| `npm run build:functions`                                                      | 0          | Native deployable Functions bundle                                                 |
| `npm run check:contract-release`                                               | 0          | Fresh isolated compiler/artifact comparison                                        |
| `npm run check:bundle-boundary`                                                | 0          | Actual public API/browser graphs exclude payment/test SDKs and vulnerable packages |
| `npm run db:migrate:local -- --persist-to <fresh owned local directory>` twice | 0 / 0      | All six applied, then checksum-preserving no-op                                    |
| `npm audit`                                                                    | 1          | 5 high + 12 moderate                                                               |
| `npm audit --omit=dev`                                                         | 1          | 5 high                                                                             |
| `forge fmt --check`                                                            | 0          | From contracts root                                                                |
| `forge build --sizes`                                                          | 0          | Solc 0.8.38, runtime 4,172 / initcode 4,239 bytes                                  |
| `forge test -vvv`                                                              | 0          | 47 passed, 0 failed, 0 skipped; fuzz/invariant settings preserved                  |
| `forge test --gas-report`                                                      | 0          | 47 passed, deployment 955,984 local gas units                                      |
| `git diff --check`                                                             | 0          | Whitespace check                                                                   |
| `git status --short`                                                           | 0          | Local changes plus twelve preserved archives; no Git mutation                      |

Negative package-isolation probe: Wrangler exits **1** when required SVM resolution is removed and **0** with the supported peer tree restored. This is intentional packaging evidence, not an application pass or advisory remediation. Full audit failures remain release blockers; tests passing does not override them.

## Remaining mandatory gates and owner actions

| Gate                              | Current status                     | Required next evidence / decision                                                                                                                                                     |
| --------------------------------- | ---------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dependency graph                  | BLOCKED                            | Supported upstream CDP/Zod/Kit and minimatch-parent remediation, or separately approved SDK-boundary redesign; rerun all relevant tests/audits                                        |
| Contract compiler/artifact        | LOCAL PASS, OWNER REVIEW           | Review exact source, reproducible manifest, immutable limitations and binary provenance; independent audit is not claimed                                                             |
| Real registry deployment          | UNVERIFIED, AUTHORIZATION REQUIRED | Exact secure signer/wallet, max ETH/all-fee budget, provider, one deployment, source verification and actual address/code/block evidence                                              |
| Registry trust/admission          | BLOCKED                            | Approved provider/finality/freshness/code/address policy, real canonical observations and reviewed production admission/checkpoint/journal authority; no local promotion              |
| CDP/live payment behavior         | UNVERIFIED                         | Separately approved credentials/permissions/cost caps and evidence of actual exact-EVM execution/receipt shape; no live call authorized here                                          |
| Settlement orchestration/recovery | BLOCKED                            | Reviewed production gateway/evidence admission/reconciliation integration, durable provider/idempotency contract, restart/conflict policy; raw observer success is insufficient       |
| Upstream connection safety        | BLOCKED                            | Owner chooses and approves narrowed fixed service-binding design or another demonstrably safe in-stack transport; concrete implementation/configuration/security proof still required |
| Time/D1 consistency               | BLOCKED                            | Approved clock/skew/deadline and primary/session/recovery policies; real runtime/provider evidence; distributed effects cannot be made one transaction                                |
| Paid-but-unfulfilled service      | BLOCKED                            | Owner-approved authenticated recovery, retention/support/dispute policy and implementation; no automatic refund/recharge                                                              |
| Operational safety                | PARTIAL / BLOCKED                  | Approve global budget values and new 0006 rollout; edge/fairness/retention/alerts/load/backups/restore and real free-plan/account budget evidence remain                              |
| Public payment exposure           | PASS for disabled state            | Actual Functions exclude mocks/observer/gateway; keep this boundary until every enabling condition passes                                                                             |
| Existing control-plane domain/D1  | OWNER-REPORTED PASS                | Existing local config preserved and owner smoke evidence acknowledged; no repeated DNS/deployment/remote mutation                                                                     |
| Mainnet smoke test                | UNVERIFIED, AUTHORIZATION REQUIRED | Exactly one separately approved buyer/payee/registry/resource/USDC amount, ETH/CDP/all-fee caps and evidence/stop plan, only after other gates pass                                   |

**Final verdict: BLOCKED.** This task delivered local compiler/artifact, admission-read, cryptographic settlement observation, parsing/privacy, abuse-budget, CI and regression improvements across the remaining checklist. It does not turn a local simulator into a production gateway, authorize narrowing the product silently, supply a secure arbitrary-HTTPS connection, or resolve an unsupported dependency graph. Further integration/security engineering is explicitly listed above; the owner should not infer that only a manual contract broadcast remains.

No Git add/commit/push/pull/fetch/merge/checkout/reset/config/branch mutation, deployment, real RPC/CDP/upstream request, transaction signing/broadcast, USDC transfer, ETH spend, production credential collection, remote D1, Cloudflare/DNS mutation or unrelated repository operation occurred. Only ephemeral unfunded typed-data test keys were generated within existing/new local test processes; they were never printed, persisted or used for a transaction. SG-07 remains IN PROGRESS; no SG-08 work or roadmap completion change was made. Stop for owner/ChatGPT review.

## SG-07 continuation — durable settlement observation review at `a48436f`

This addendum records the next local-only continuation; the earlier compiler comparison and prior remediation evidence above were not repeated or rewritten. Read-only Git inspection began at owner checkpoint **`a48436f`** with only the twelve existing review archives untracked. No tracked edits were present before this continuation. No applicable `AGENTS.md` or canonical V2 rules/roadmap files were available locally.

### Registry admission boundary

The existing `createRegistryReview` already composes the server-side D1 resource/binding snapshot, pinned registry reader, and append-only `registry_evidence_journal` write. It uses resource revision and binding generation CAS, stores provenance and RPC response digests, preserves replay/conflict outcomes, and always returns `productionAdmitted: false`. Migration 0004/0005 quarantine and the database triggers still prohibit `onchain_confirmed` writes; no code path was added to bypass those controls. This review flow remains review-only. It cannot establish an approved contract deployment, trustworthy RPC source, code-hash authorization, canonical finality policy, or production admission authority. These are not locally resolvable from fixtures, and production admission remains blocked pending owner-approved real deployment evidence and a separately reviewed trust policy.

### Settlement observation/D1 integration

Added migration **0007** (`migrations/0007_sg07_settlement_observations.sql`) and internal `server/sg07/settlement-review.ts`. The local review service loads a specific D1 attempt under a server-supplied merchant ID, requires `settlement_unknown` plus exact local-simulation provenance, and derives payer, recipient, amount, asset, network, authorization identity and fingerprint from that row. It invokes the existing read-only Base 8453 observer using an internally supplied candidate hash, validates the observer result again, and appends only a `LOCAL SIMULATION ONLY` observation. Duplicate identical observations are idempotent. Different transaction/configuration evidence for the same attempt creates a durable `conflict` outcome; effective review state remains conflicted thereafter.

Migration 0007 creates one append-only `settlement_evidence_observations` table with foreign keys to the exact attempt, merchant, and composite resource ownership. SQL checks constrain Base Mainnet, native USDC, exact integer atomic amount, local-simulation provenance, and the JSON evidence marker `rpc_observation_only` / `productionAdmitted:false`. An insert trigger matches every recorded identity field against the current attempt and requires its state still be `settlement_unknown` and `evidence_kind='local_simulation'`. Update/delete triggers make rows immutable. The table has no path into `payment_receipts`, `analytics_events`, attempt phase transitions, or protected response release. The production Pages route tree does not import this service.

This is an **audit/review record**, not payment reconciliation or settlement admission. It intentionally cannot mark a payment settled, resolve an unknown state, authorize content, or represent authentic Mainnet evidence. A candidate hash is only an internal lookup hint and the mock RPC source remains untrusted. The production orchestration still lacks approved RPC/provider authority, independently reviewed finality policy, trusted evidence admission and a crash-safe operator recovery path. No real facilitator hash or real transaction was used.

### Targeted verification and current dependency recheck

The targeted `npm run test:release-security` completed with **62 checks passed** in actual local Wrangler Pages/workerd and D1. New cases cover successful observer-to-D1 review persistence, duplicate idempotency, server-supplied merchant isolation, rejection of forged authority/amount fields without writes, append-only update/delete denial, durable conflict recording, unchanged `settlement_unknown` and `local_simulation` attempt state, and zero payment receipts. Existing 56 checks remain intact. Local RPC fixtures and unfunded typed-data test keys only; all observations are explicitly non-authoritative.

Fresh `npm audit` still exits 1 with **17 affected entries (5 high, 12 moderate)**; `npm audit --omit=dev` exits 1 with **5 high**. Current [CDP 1.60.0](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0) metadata still requires Zod `^3.25.76`, SVM `^2.25.0`, and `@solana/kit ^5.5.1`; patched [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0) requires Kit `>=8.0.0`, so it is not a compatible swap. Current [x402 core 2.29.0](https://registry.npmjs.org/@x402/core/2.29.0) uses patched Zod 4, but CDP's direct Zod-3/abitype requirements remain. Latest [`@eslint/config-array` 0.23.5](https://registry.npmjs.org/@eslint/config-array/0.23.5) and [typescript-eslint 8.72.1](https://registry.npmjs.org/typescript-eslint/8.72.1) still require minimatch `^10.2.x`; [minimatch 11.0.4](https://registry.npmjs.org/minimatch/11.0.4) is outside that supported parent range. No dependency was changed and no advisory was suppressed. The Zod/CDP and minimatch parent-chain blockers remain unresolved.

### Commands and results for this continuation

| Command                           | Result                                                                                    |
| --------------------------------- | ----------------------------------------------------------------------------------------- |
| `npm run test:release-security`   | PASS, 62 local Pages/workerd + D1 checks                                                  |
| `npm run test:registry-admission` | PASS, 43 checks                                                                           |
| `npm run test:sg05`               | PASS, 122 checks                                                                          |
| `npm run test:sg07`               | PASS, 72 checks                                                                           |
| `npm run test:sg03`               | PASS, 14 checks                                                                           |
| `npm run test:sg06`               | PASS, 20 checks                                                                           |
| `npm test`                        | PASS, exit 0; 396 checks across nine suites (17 + 14 + 14 + 122 + 20 + 72 + 43 + 32 + 62) |
| `npm run build`                   | PASS                                                                                      |
| `npm run lint`                    | PASS                                                                                      |
| `npm run format:check`            | PASS after formatting this report                                                         |
| `npm run build:functions`         | PASS                                                                                      |
| `npm run check:bundle-boundary`   | PASS; production Functions/browser graphs exclude SG-07 review and test-only code         |
| `npm audit`                       | FAIL, 17 findings (5 high, 12 moderate), exit 1                                           |
| `npm audit --omit=dev`            | FAIL, 5 high findings, exit 1                                                             |
| `git diff --check`                | PASS                                                                                      |

The migration is forward-only. All previous migration bytes are unchanged. Local D1 applies the seven migrations and a second invocation verifies the stored digests and reports no pending migration. No remote D1 operation was performed.

### Changed files in this continuation

- `migrations/0007_sg07_settlement_observations.sql`
- `server/sg07/settlement-review.ts`
- `tests/release-security/handler.ts`
- `tests/release-security/run.mjs`
- `tests/sg03/run.mjs`
- `tests/sg05/run.mjs`
- `tests/sg06/run.mjs`
- `tests/registry-admission/run.mjs`
- `docs/SG-07_REMEDIATION_REPORT.md`

### Current decision and next required owner decision

**SG-07 remains IN PROGRESS; production launch remains BLOCKED.** The safe local integration is durable and deliberately non-authoritative. It does not complete production registry admission or payment reconciliation. Next, the owner must decide whether to authorize a real deployment and identify the trusted RPC/finality and registry-admission authority, then separately approve CDP permissions/credentials and a recovery policy. The unresolved dependency graph and upstream connection-safety/product-scope decision remain engineering/release blockers; they cannot be cleared by the local D1 observation journal. Keep payment and arbitrary upstream fulfillment disabled. No Git mutation, deployment, external RPC/CDP request, signing, spending, or phase transition occurred.

## Deployed EndpointRegistry application integration — current continuation

The owner has now supplied a successful Base Mainnet deployment at **`0xC4081a85935de1b9a929e5a6835d99471cd08c01`**, with Foundry cast confirming runtime Keccak **`0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df`**, matching the solc 0.8.38 release record. Earlier statements that no registry deployment exists are historical. This task did not repeat compiler comparisons or query a live RPC. Deployment transaction/block and explorer source verification were not supplied, so none is invented. `REGISTRY_DEPLOYMENT.json` preserves the supplied evidence separately from the reproducible predeployment artifact record.

The server-owned `server/registry/status.ts` pins that identity and exposes authenticated GET-only `/api/registry`, optionally filtered by an owned `resourceId`. Missing RPC configuration, bad chain/code/CHAIN_ID, stale or inconsistent blocks, RPC failure, binding commitment/owner/version/price/payout mismatch, pending transfer, disable, conflict, or revision/generation changes cannot produce an admitted registration. The handler uses existing viem ABI/hash functions, prepared ownership-filtered D1 reads, a server-only explicit HTTPS RPC endpoint, no redirects/retries/fallback, bounded response streaming and an abort deadline. Requests carry only fixed RPC method parameters. No buyer headers or secrets are forwarded. Canonical finalized identity is rechecked; resource head configuration must match. This is provider observation, never independent consensus proof or production evidence admission.

The dashboard offers explicit read controls per merchant and resource, loading/error states, owner-verified deployment identity, runtime observation, resource status and unverified explorer status. Missing bindings show no registered claim. A matching resource observation is labelled `matching_observation_only`; it does not write `onchain_confirmed`, receipts, analytics or payment phases. Public payment routing and arbitrary upstream transport remain disabled. Migrations 0006/0007 and settlement-review changes are preserved; no new migration or remote application is needed for this code.

Local tests extend native workerd/D1 fixtures with the exact release bytecode, wrong chain/code/CHAIN_ID and stale-block rejection, matching/unregistered/mismatched owned resources, unchanged unconfirmed bindings and disabled admission. Authenticated API tests also cover missing RPC configuration, unauthenticated access and cross-merchant denial. All network responses are local mocks. Final verification results are recorded below after completion.

Files added in this continuation: `server/registry/status.ts`, `src/sg03/RegistryStatus.tsx`, `docs/REGISTRY_DEPLOYMENT.json`. Files modified: `server/sg03/api.ts`, `src/sg03/Workspace.tsx`, `tests/release-security/handler.ts`, `tests/release-security/run.mjs`, `tests/sg03/run.mjs`, `docs/ENVIRONMENT.md`, `docs/RELEASE_CHECKLIST.md`, `docs/SG-07_LAUNCH_RUNBOOK.md`, `docs/SG-07_REMEDIATION_REPORT.md`. Previously uncommitted migration 0007, settlement review and test-runner updates remain intact.

**SG-07 remains IN PROGRESS; launch remains BLOCKED.** Next owner decisions are the approved read-only RPC provider and production observation policy, genuine deployment transaction/block and explorer verification evidence, and the separately reviewed admission authority. CDP/Zod/minimatch dependency remediation, settlement reconciliation/admission, trusted operational time/recovery, secure upstream architecture, and production migration approvals remain separate gates. Contract deployment alone does not clear them. No deployment, signing, spending, real payment, production mutation or Git mutation occurred here.

Verification for deployed-registry integration:

| Command                                                                            | Exit / actual result                                                                                                                                                |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                                                         | 0; 398 checks (17 foundation, 14 compatibility, 14 SG-03, 122 SG-05, 20 SG-06, 72 SG-07, 43 registry admission, 32 upstream, 64 release security)                   |
| `npm run test:release-security`                                                    | 0; final 64 native workerd/D1 checks after canonical recheck and actual `ResourceNotFound(bytes32)` revert handling refinements                                     |
| `npm run test:sg03`                                                                | 0; 14 checks, including final Chromium registry control click and honest missing-provider/source-verification state, authenticated API and cross-merchant rejection |
| `npm run build`, `npm run lint`, `npm run format:check`, `npm run build:functions` | 0                                                                                                                                                                   |
| `npm run check:bundle-boundary`                                                    | 0; 463 Functions inputs, 1,781 browser inputs; payment/test SDK/Zod/minimatch boundary preserved                                                                    |
| `forge fmt --check`, `forge build`, `forge test -vvv`                              | 0; 47 tests passed, 0 failed/skipped; no compiler comparison or deployment                                                                                          |
| `npm audit`, `npm audit --omit=dev`                                                | 1; 5 high + 12 moderate / 5 high respectively; no dependency changes or suppression                                                                                 |
| `git diff --check`                                                                 | 0                                                                                                                                                                   |

Resolved development failures: the initial TypeScript compile required the installed Workers TextDecoder `ignoreBOM` option; the local authenticated fixture initially supplied a nonconforming cookie token; the new Chromium locator initially matched multiple cards and was scoped to the final merchant deployment card. All were corrected and their affected checks rerun successfully. No assertions establishing ownership, runtime identity, registration status, admission denial, or payment isolation were removed. Full aggregate regression passed before the final narrow canonical/revert refinements; final targeted registry, D1/browser and build checks cover those refinements. Evidence logs are local ignored `.wrangler/deployed-registry-*` artifacts. All twelve review archives and prior local changes remain preserved.

## Registry observation failure and duplicate-panel correction — `4595836`

**Current status: local correction under review; production payments/upstream remain disabled, SG-07 IN PROGRESS.** Read-only Git inspection confirmed owner checkpoint `4595836` and no tracked changes initially; twelve review archives remain intact. No applicable repository/ancestor AGENTS.md or canonical V2 files were present. Owner reports Pages deployment success, production migration 0006 applied, production RPC secret configured and SIWE login successful. These supersede earlier setup-pending notes; no Cloudflare setting, deployment or migration (including 0007) was performed here.

### Confirmed cause and read-only evidence

The app rejected every finalized block older than **300 seconds** before checking code. That conflicts with Base's normal L1-derived finality: [official Base finality documentation](https://docs.base.org/specifications/transactions/transaction-finality) describes L1 batch finality at approximately **20 minutes**. This is distinct from a fresh L2 head. The old test fixtures placed finalized blocks only 10 seconds behind the clock and missed this normal condition.

At **2026-11-02 17:45:58 UTC** (November 3 Jakarta), a minimal diagnostic against the documented public Base RPC returned:

- Chain `0x2105` (8453).
- Finalized block `0x32f3570`, hash `0x5b3f3fae0290630c62195063e0ac0a7ecedb6672b86f269d640dd6650d2e8968`, age **1,171 seconds**.
- Latest head `0x32f37ba`, sampled timestamp approximately one second ahead of the initial diagnostic clock; its timestamp advanced during the separate calls.
- Hash-pinned `eth_getCode` with EIP-1898 `{blockHash,requireCanonical:true}` succeeded; runtime **4,172 bytes**, Keccak **`0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df`**.
- Hash-pinned `CHAIN_ID()` returned **8453**; the numbered canonical recheck matched the finalized hash.

Thus a healthy public provider/contract observation is reproducibly rejected by the old 300-second condition. The configured production secret/provider was neither read nor printed, and no authenticated production API call was made, so this does **not** prove that this is the only failure affecting that provider. Unsupported EIP-1898, provider errors/rate limits, stale state and timeouts remain possible and now have safe diagnostics. Initial Python requests returned HTTP errors; curl-based read-only calls succeeded. Seven successful public read calls (including the initial chain probe) and three failed HTTP read attempts were made; no writes/signing/broadcast occurred. Only sanitized public block/hash metadata was retained in ignored `.wrangler/registry-rpc-evidence.json`.

### Bounded observation policy and diagnostics

`observationPolicy` now separates three checks: finalized age at most **30 minutes**, head age at most **60 seconds**, and head/finalized timestamp lag at most **30 minutes**. Both block timestamps retain the **one-second future-skew bound**. The 30-minute read-only ceiling allows the documented ~20-minute normal finality plus ten minutes of bounded availability margin; it is a deliberate application policy, not a chain SLA or approval for payment finality. Larger legitimate delays still fail closed. Wall-clock/provider trust remain external release limitations.

The RPC read remains finalized, never silently substituted with latest. Latest is used only for provider freshness/consistency and the existing resource-change check. Code hash, CHAIN_ID, exact Base chain, EIP-1898 requireCanonical access, head/config comparisons, both canonical block rechecks, ownership filtering, D1 revision/generation checks and quarantine remain. The wall clock is sampled at the relevant read rather than assuming zero latency between sequential calls.

The RPC observation phase (after authentication and the initial D1 ownership snapshot) now races a **hard five-second deadline**; abort is signalled, response streams are cancelled and late work cannot start another RPC. The original code only requested abort and could hang when an injected transport/stream ignored it. Response size remains 128 KiB. JSON-RPC ID/version and mutually exclusive result/error shape are checked before handling errors. Redirects, malformed content, rate limits and unsupported canonical reads deny observation; no retry/provider/state fallback was added. Categories include `finality_stale`, `head_stale`, `wrong_chain`, `runtime_mismatch`, `canonical_read_unsupported`, `rpc_rate_limited`, `rpc_http_error`, `rpc_error`, `rpc_malformed`, `rpc_response_limit`, `rpc_timeout`, `configuration_invalid`, `consistency_changed` and generic `observation_unavailable`. No URL, credential, raw RPC message/data or body enters the response or logs. Dashboard shows the safe category and successful sampled block age. `productionAdmitted` and `paymentsEnabled` remain false.

### Confirmed duplicate UI cause

The global RegistryStatus and adjacent Activity component both had the React sibling key `merchant.id`. Repeated resource/session rerenders accumulated **13 global panels** in the native browser reproduction, while two legitimate resource panels existed. The prior `.last()` browser selector hid this defect. The global panel now uses the distinct key `registry:<merchant ID>`. The test removes `.last()` and requires **exactly one** global control plus the same number of per-resource controls as resource edit controls, after creation/edit/disable rerenders. Merchant changes/logout retain existing unmount/cache isolation.

The local test harness now explicitly binds `REGISTRY_RPC_URL` to an empty string by default. The missing-configuration browser fixture previously reached a configured/unavailable observation instead of its expected missing-config state. Explicit blank binding makes the local test independent of inherited local settings; injected RPC fixtures still use their own literal mock endpoint. No secret value was inspected, and fixture egress interception remained active.

### Files and verification

Changed in this task: `server/registry/status.ts`, `src/sg03/RegistryStatus.tsx`, `src/sg03/Workspace.tsx`, `scripts/local-runtime.mjs`, `tests/release-security/handler.ts`, `tests/release-security/run.mjs`, `tests/sg03/run.mjs`, `docs/ENVIRONMENT.md`, `docs/SG-07_REMEDIATION_REPORT.md`. No dependency, contract, migration, deployment configuration or payment-state-machine changes.

New native workerd/D1 regression cases exercise normal twenty-minute lag, truly stale finality/head, wrong chain, EIP-1898 unsupported errors, malformed RPC envelope, RPC errors, 429/HTTP failure, never-resolving transport, slow streamed body and canonical hash conflict. They assert unavailable/non-admitted results and unchanged unconfirmed D1 bindings, and reject provider-secret/endpoint leakage. Existing cryptographic identity, resource isolation, registry quarantine, settlement idempotency, receipt provenance, and production route isolation assertions remain in force. Final command results follow after verification completes.

Final verification for the observation correction:

| Command                                               | Actual exit/result                                                                                                                                   |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                       | 0; TypeScript and Vite build                                                                                                                         |
| `npm run lint`                                        | 0                                                                                                                                                    |
| `npm run format:check`                                | 0                                                                                                                                                    |
| `npm run test:release-security`                       | 0; 76 local workerd/D1 checks; the final aggregate additionally verifies exact RPC call counts and no fallback on unsupported/failed/timed-out reads |
| `npm run test:sg03`                                   | 0; 14 API/browser checks including strict single-global-panel and retained per-resource-panel assertions                                             |
| `npm test`                                            | 0; **410** checks = 17 + 14 + 14 + 122 + 20 + 72 + 43 + 32 + 76; includes all prior payment/registry/upstream suites                                 |
| `npm run build:functions`                             | 0                                                                                                                                                    |
| `npm run check:bundle-boundary`                       | 0; 463 Functions inputs / 1,781 browser inputs; payment SDK, fixtures, Zod and minimatch remain outside public graphs                                |
| `forge fmt --check`, `forge build`, `forge test -vvv` | 0; 47 passed, 0 failed/skipped; no contract changes or compiler comparison                                                                           |
| `npm audit`                                           | 1; 5 high + 12 moderate, unresolved                                                                                                                  |
| `npm audit --omit=dev`                                | 1; 5 high, unresolved                                                                                                                                |
| `git diff --check`                                    | 0                                                                                                                                                    |

The initial duplicate reproduction logged 13 global controls; the strict test passes after the key correction. An intermediate browser test/full aggregate timed out expecting the missing-config message while its local environment produced the unavailable-observation branch. After the explicit empty local RPC binding, the API/browser test and entire aggregate were rerun successfully. Neither the strict count/ownership assertions nor the stale/canonical/code-hash gates were weakened. Tests use local fixtures and do not replay the public diagnostic reads. Final evidence logs are ignored `.wrangler/registry-observation-*` artifacts.

**Owner review boundary:** the locally confirmed defect is the 300-second finalized-age gate; the actual configured production provider has not been inspected or certified. After owner-managed publication, review the authenticated status and its safe diagnostic category. `canonical_read_unsupported` requires an owner-approved capable provider; `finality_stale`/`head_stale`, rate limiting or timeouts remain intentional denials. No fallback or larger policy should be introduced automatically. Public RPC success is not proof of the secret provider's behavior or a production payment finality policy. All dependency, trusted admission/reconciliation, clock/operations and secure upstream gates remain in force. No Git mutation, public deployment, remote D1 operation, signing/broadcast, spending, DNS change or payment activation occurred. SG-07 remains IN PROGRESS and launch BLOCKED.

## Payment-first continuation — checkpoint 6af7855

Owner prioritizes x402 completion ahead of Builder Code or grant submission. See [current payment implementation review](SG-07_PAYMENT_COMPLETION_REPORT.md) for exact defects/fixes, dependencies, verification and decision packet. Local reconciliation now requires the authorization fingerprint and owns its lookup deadline; settlement CAS binds the full attempt snapshot; local advance/recovery is restricted to its evidence realm; facilitator protocol inputs are immutable across injected SDK calls. Public payment routes, receipt admission and arbitrary upstream fetching remain disabled.

Fresh upstream metadata still leaves the CDP/Zod/Kit and minimatch parent compatibility blockers unresolved. The alternate official @coinbase/x402 package also depends on CDP and Zod 3, so it does not supply a secure shortcut. Alchemy registry observation success is acknowledged as owner evidence; it does not populate finalized per-resource binding admission or settlement recovery authority. The report supplies concrete upstream choices and production integration tasks rather than claiming only credentials/live testing remain. No Builder Code, grant, deployment, production signing/broadcast, live payment, production secret/Cloudflare/D1/DNS or Git operation was performed. SG-07 IN PROGRESS; launch BLOCKED.

## Local secure internal JSON pilot

The owner requested the bounded local internal-handler experiment. See [SG-07_INTERNAL_JSON_PILOT_REPORT.md](SG-07_INTERNAL_JSON_PILOT_REPORT.md). A fixed owner-controlled payment-configuration JSON document now composes the existing local gateway without any HTTP/DNS/proxy capability. Captured manifest identity/hash and a fulfilling local attempt with consistent persisted receipt gate delivery; public routing and production evidence admission remain disabled. No new production schema/service binding/credentials were introduced. Prior uncommitted payment-hardening work, seven migration files and twelve archives remain intact. The pilot is local review evidence, not approval of production scope or a Mainnet payment.

## Internal pilot manifest, revocation and chain-evidence continuation

See [SG-07_INTERNAL_PILOT_ADMISSION_REPORT.md](SG-07_INTERNAL_PILOT_ADMISSION_REPORT.md) for the exact local manifest, immutable operator admission, permanent revocation latch, payment-boundary rechecks and canonical USDC fixture evidence gate. The fixture ledger remains isolated temporary D1, not a production schema or permission. Revocation advances payment revision, rejects replacement/replay/re-enabling, survives restart and preserves submitted settlement evidence and receipts. Unknown outcomes cannot automatically settle again. Production admission, public paid routing and arbitrary upstream fetching remain disabled.

Fresh metadata provides no new supported secure CDP/Zod/SVM/Kit or minimatch parent combination. Audits remain 5 high + 12 moderate full, 5 high production-only; no dependency change/suppression. The next decision is the concrete production admission/manifest authority and supported SDK remediation path, not immediate payment activation. No canonical roadmap was available to edit; SG-07 stays IN PROGRESS pending owner review.

Current checkout clarification: read-only `git symbolic-ref --short HEAD` reports `wip/sg07-remediation-20261102` at HEAD `6af7855`. Earlier `main` descriptions are historical/stale for this working tree. The existing branch and all uncommitted changes are preserved; no branch or Git mutation was performed.

## Settlement-admission architecture and dependency boundary continuation

[SG-07_SETTLEMENT_ADMISSION_REPORT.md](SG-07_SETTLEMENT_ADMISSION_REPORT.md) records the new local pre-admission checkpoint/nonce/opaque-candidate boundary and integration with pilot reconciliation. Durable conflict checks now run inside receipt and fulfillment CAS. A native D1 regression reproduced journal conflict loss through INSERT OR REPLACE; forward 0008 prevents identity replacement without editing 0001–0007. This correction is local-only and needs separate remote migration approval. No production admission authority or paid route was enabled.

A public-export candidate using CDP auth plus Foundation HTTP client excludes vulnerable Zod 3/SVM/Solana from its isolated build. It does not fix the installed graph or prove JWT/live CDP operation: audits remain blocked. Owner review must choose a supported dependency/authentication strategy and approve production registry/manifest/settlement evidence authority before production integration. The current branch and all earlier dirty work remain preserved. SG-07 IN PROGRESS; launch BLOCKED.

## Owner-authorized Builder Code continuation

The owner explicitly requested local integration of `bc_ipzfx50y`; earlier deferral notes are historical. [BUILDER_CODE_INTEGRATION.md](BUILDER_CODE_INTEGRATION.md) records official sources, installed SDK support and exact changes. CDP now explicitly documents the builder-code extension for EVM settlement. The isolated native x402 gateway advertises the official app declaration and validates bounded matching echoes without changing signed authorizations or payment identity. The local mock sender uses the official suffix builder; normal production routing remains unchanged. No live attribution, grant approval, registration lookup, transaction signing/broadcast or payment is claimed. SG-07 stays IN PROGRESS with all existing payment release gates intact.

## Current continuation: production activation implementation, still default disabled

See [SG-07_X402_PRODUCTION_ACTIVATION_REPORT.md](SG-07_X402_PRODUCTION_ACTIVATION_REPORT.md) for the native route, public CDP JWT/direct REST boundary, one-use durable settlement permits, finalized canonical USDC admission, immutable receipt/quarantine, bounded 202 handoff/recovery and shared fixed JSON handler. This supersedes older absence-of-integration statements; it does not turn historical simulations into Mainnet evidence. The contract, production Wrangler/D1 settings, public switch defaults and arbitrary-upstream denial are preserved. New migration 0009 and operator manifests were applied only to isolated local D1 fixtures; production 0007/0008/0009 were not applied. Fresh audits remain failing (5 high + 10 moderate full; 5 high production). SG-07 remains IN PROGRESS, activation BLOCKED pending owner/security review and independently authorized external evidence.
