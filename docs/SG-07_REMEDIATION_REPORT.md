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
