# SG-07 internal JSON pilot admission continuation

SG-07 remains **IN PROGRESS**. Production payments and arbitrary merchant upstream fetching remain **BLOCKED**. This is local engineering evidence, not launch approval or an independent security audit.

## Baseline and scope

Read-only inspection confirmed HEAD `6af7855`; the current branch is `wip/sg07-remediation-20261102`, with the previous 439-check/148-payment-check internal pilot and payment hardening already uncommitted. All previous changes and twelve review archives were preserved. No applicable AGENTS.md or canonical V2 rules/roadmap files were available locally; no replacement rules or phase checklist was created. The supplied phase status is retained; absent canonical files prevent independently reconciling the roadmap ledger.

Earlier report descriptions of `main` are stale relative to this working checkout. The branch was preserved; no branch creation/switch or Git mutation was performed.

The owner-reported deployed registry and working Alchemy observation remain acknowledged evidence. This task makes no live RPC, upstream, CDP or production API calls. A deployed contract or successful observation does not admit a resource or authorize a payment.

## Defects and local implementation

The previous handler froze a captured resource snapshot but had no separate durable operator revocation authority. A mutable fixture snapshot alone did not express an immutable handler/registry manifest, nor independently check chain evidence before a simulated receipt was stored.

`server/sg07/internal-manifest.ts` defines an exact server-controlled manifest: fixed handler `signalarc.resource-configuration.v1`, manifest version, local-only provenance, production admission false, chain 8453/network/native USDC, deployed registry address and pinned runtime hash, original/current owner, merchant/resource UUID, owner-namespaced onchain ID, configuration commitment/version, binding generation, resource revision, enabled state, snapshot hash, atomic amount and payout. The address/hash identify the intended deployment; they do **not** claim the simulated resource exists onchain. Local snapshots still require `local_simulation` and a null registry address.

`createLocalInternalJsonPilot` now requires an internal authority capability; there is no public manifest body/header, transport selector, handler dispatcher or registration route. It checks the live admitted tuple and revocation at construction, every eligibility boundary and before/after the prepared paid-record query. The gateway already rechecks eligibility before verification, settlement and fulfillment; it additionally rechecks after asynchronous challenge construction and after the durable settlement claim, immediately before submission. Failed pre-submission admission is definitively failed only while no settlement invocation has started. A failed state write leaves conservative durable recovery rather than silently issuing a new charge.

The isolated fixture extends its **existing temporary local table**, not the application schema, with immutable admission JSON and a one-way revocation latch. SQL triggers reject admission/identity mutation, deletion, replacement insertion and re-enabling. Revocation advances the resource payment revision in the same transaction, invalidating outstanding payment CAS guards. `INSERT OR REPLACE` has a separate insert guard because SQLite replacement deletion must not be assumed to run ordinary delete triggers. Repeated revocation is idempotent. A failed D1 batch rolls back both revocation and revision. There is no resolution/reapproval route: a future approval policy requires review.

No migration, remote D1 operation, production binding or credential is introduced. Existing migrations 0001–0007 remain unchanged. Local migration/checksum repeatability and SG-03 row preservation are exercised by the existing harness. A production operator ledger, its admission permissions, audit trail and reviewed forward migration are an explicit next approval boundary; the fixture table must not be copied into a deployment automatically.

## Payment evidence and preservation

An optional **local-only** evidence gate on the existing transport interface is applied before gateway receipt persistence, before pilot reconciliation receipt persistence and again before internal delivery. Failure after submission leaves `settlement_unknown`; it does not establish that USDC failed to move. There is no automatic resubmission. A failed canonical check during local reconciliation preserves the unknown attempt with no receipt or analytics; a receipt already persisted by valid local reconciliation cannot bypass a later conflicting delivery check. Final source review identified the original recovery bypass after an initial successful full regression, and the same evidence capability was added to reconciliation before its settlement CAS. The revoked pilot still verifies settlement evidence independently of delivery permission.

The fixture gate reuses `createSettlementObserver` rather than an SDK boolean/hash comparison. Node constructs deterministic simulated transaction/receipt/block/event responses from the existing isolated cryptographic authorization fixtures. Native workerd checks:

- Base chain, native USDC recipient contract, successful receipt and exact transaction/block linkage;
- finalized block, confirmation depth, bounded freshness and canonical block rechecks;
- decoded direct USDC EIP-3009 calldata, recovered typed-data signer, validity window and exact authorization identity/fingerprint;
- exactly one correct native USDC Transfer and AuthorizationUsed event, payer/payee/amount/nonce, non-removed unique logs;
- consumed authorization at an EIP-1898 hash-pinned canonical finalized block.

The test transport rejects unsupported reads. It has no live RPC capability. The observer continues to return `rpc_observation_only`, `productionAdmitted:false` and `sourceId:LOCAL_SIMULATION_ONLY`. Receipts remain `local_simulation`, with `LOCAL_SIMULATION_ONLY` block provenance; no mock is upgraded to Mainnet proof. The direct-USDC transaction subset is still not a certification of actual CDP transaction construction or provider trust. The fixture's two-confirmation/60-second policy is a test parameter, not approved production finality policy.

A revocation after submission does not erase the actual simulated settlement result. A valid local receipt is retained with settled coarse status and `fulfillment_failed`; no content or second charge follows. Unknown outcomes remain recoverable after revocation, but recovered receipts cannot restore revoked delivery permission. Restart retains the revocation latch, revision and unknown attempt. Local lookup/reconciliation remains a fixture, not an invented CDP status API.

## No-network delivery and concurrency limits

The handler remains a fixed JSON configuration document with no HTTP/DNS/socket/proxy capability. It never dereferences the HTTPS commitment identifier, forwards buyer headers, returns private upstream configuration or accepts arbitrary handler callbacks. Existing byte/structure/deadline/no-store and exact paid-record joins remain.

No database transaction can make revocation atomic with an external facilitator call or HTTP delivery. Checks and revision CAS reject changes observed before their boundary; an operator revocation after submission cannot undo a submitted payment. A last-moment revocation after the final fulfillment CAS cannot recall bytes already released. The receipt remains durable and requires authorized recovery review. No exactly-once client delivery, automatic refund or production recovery mechanism is claimed. Production D1 consistency, clock policy and operator authorization remain release gates.

## Dependency review

Fresh npm metadata shows no new compatible secure graph: CDP **1.60.0** requires Zod `^3.25.76`, abitype `1.0.6` and Solana Kit `^5.5.1`; SVM **2.29.0** requires Kit `>=8.0.0`, whereas installed SVM **2.28.0** retains vulnerable nested core/Zod. Root core/EVM/extensions remain **2.29.0**. The alternate official `@coinbase/x402` **2.1.0** also depends on CDP and Zod 3. Latest config-array **0.23.5** and typescript-estree **8.72.1** still require minimatch 10. Installed versions and lockfile are unchanged.

[Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) requires Zod >=4.6.6; current latest is 4.6.7. [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) requires >=11.0.1; latest is 11.0.4. Those patched majors are outside affected parent ranges. Full audit remains **5 high + 12 moderate** affected entries; production-only remains **5 high**. These propagate two root advisories, not seventeen independent vulnerabilities. No forced upgrade, override, advisory suppression or dependency removal was made. Input limits and bundle isolation are defenses, not remediation.

Supported next options are patched upstream parent releases or a separately reviewed official EVM/CDP packaging boundary. Removing/replacing the approved SDK or forcing incompatible peers is not authorized. Public Functions/browser bundle checks must continue excluding the local gateway, fixtures, payment SDK, Zod and minimatch; that does not make the installed graph clean.

## Owner decisions before one Mainnet payment

1. Review this exact fixed internal-handler scope and server manifest. Approve a durable production admission/revocation schema and operator authority before implementing that production path. No automatic reapproval after revocation.
2. Resolve the SDK/dependency graph through supported upstream fixes or approve a concrete architecture proposal for review. No blanket risk acceptance is presented as remediation.
3. Approve genuine resource registration, merchant/owner/payout/amount/version/commitment, finalized registry admission and quarantine handling. Alchemy observation alone remains insufficient.
4. Approve RPC trust/canonical finality/clock policy and independent USDC settlement admission/reconciliation. Verify actual CDP direct-USDC compatibility without inventing a status API. Persist evidence before delivery; unknown means stop, not retry charging.
5. Review remaining production orchestration, migration 0007 and any future migration digests, backup/recovery, primary/session consistency, rate limits, monitoring, paid-but-unfulfilled support and rollback. No remote migration was performed here.
6. Only after mandatory gates pass: separately authorize production publication, owner-managed CDP secret provisioning, exact buyer/merchant identities, atomic USDC amount, maximum total USDC/ETH/provider budget, time window and exactly one informed live test. No budget, wallet, transaction or explorer result is fabricated.

The next smallest bounded task is review of the production manifest/admission persistence and authority proposal, alongside the supported SDK remediation decision. More security integration work remains; deployment or a single credential is not the only remaining step.

## Concrete production proposal for review — not implemented

If the owner approves this restricted pilot scope, the next implementation should use a reviewed forward migration after 0007 for an immutable operator admission ledger keyed by resource UUID/admission ID. Bind the complete manifest hash/handler version, merchant/owners, deployment address/code hash, registry evidence checkpoint, resource revision/binding generation and exact payout/atomic price. Add append-only revocation events and transactional revision invalidation; forbid replacement, deletion, automatic reapproval and merchant-controlled confirmation. The data plane must compare the exact admission generation at challenge, settlement claim and fulfillment CAS. Re-admission after revocation requires a separately specified trusted process, not a merchant edit.

Before writing that production migration, decide who may approve/revoke, the authenticated internal execution mechanism, evidence trust/finality/clock policy, audit retention, primary/session consistency and recovery ownership. Existing confirmation-blocking triggers must remain until that reviewed authority is implemented. No new service binding is technically needed for this in-process fixed JSON handler; arbitrary merchant APIs remain a separate transport problem. This proposal is not permission to add a production confirmation route, provision secrets or run remote migrations.

## Files changed in this continuation

- New `server/sg07/internal-manifest.ts`.
- Modified `server/sg07/internal-json.ts`, `server/sg05/gateway.ts`, `server/sg05/upstream.ts`, `server/sg05/reconcile.ts`.
- Modified `tests/sg05/handler.ts`, `tests/sg05/run.mjs`.
- New `tests/sg05/chain-fixture.mjs`, `tests/sg05/chain-verifier.ts`.
- New this report; appended `docs/SG-07_REMEDIATION_REPORT.md`, `docs/RELEASE_CHECKLIST.md` and `docs/SG-07_INTERNAL_JSON_PILOT_REPORT.md`.

The existing uncommitted package script, payment store/reconciliation, facilitator and SG-07 test changes were preserved; reconciliation was narrowly extended in this continuation. No contract, lockfile, production routing/configuration or historical migration changes in this continuation.

## Final verification evidence

Targeted tests were run during development (the original 19, then 42, then the stabilized **43** checks); every run exited 0. The stabilized focused run includes the revocation restart check and stronger pre-submission recheck. An initial full aggregate exited 0. Final source review then identified and closed the pilot reconciliation receipt-validation bypass, followed by affected targeted checks and one full regression after that final stabilization, exiting 0: **463 application checks**, including **172 payment lifecycle checks**. This is 24 new payment check groups over the previous 439/148 baseline; the separate 43-check focused run is a subset, not additional application coverage counted twice.

| Command                                                     | Exit | Actual result                                                                                                                                  |
| ----------------------------------------------------------- | ---- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:internal-json`                                | 0    | 43 focused native workerd/D1 checks; 0 upstream HTTP requests, 0 duplicate settlement initiations                                              |
| `npm test`                                                  | 0    | 463: 17 foundation + 14 compatibility + 14 SG-03 + 172 SG-05 + 20 SG-06 + 75 SG-07 + 43 registry admission + 32 upstream + 76 release security |
| `npm run build`                                             | 0    | TypeScript/Vite build                                                                                                                          |
| `npm run lint`                                              | 0    | ESLint                                                                                                                                         |
| `npm run format:check`                                      | 0    | Prettier                                                                                                                                       |
| `npm run build:functions`                                   | 0    | Native Pages Functions compiled                                                                                                                |
| `npm run check:bundle-boundary`                             | 0    | 463 Functions inputs / 1,781 browser inputs, 2 chunks; local pilot/payment/test SDK/Zod/minimatch excluded                                     |
| `forge fmt --check`, `forge build`, `forge test -vvv`       | 0    | 47 passed, 0 failed/skipped, including fuzz/invariants; no contract/compiler change                                                            |
| `npm audit`, `npm audit --json`                             | 1    | 5 high, 12 moderate affected entries                                                                                                           |
| `npm audit --omit=dev`, JSON equivalent                     | 1    | 5 high affected entries                                                                                                                        |
| `npm ls` affected packages, plus public `npm view` metadata | 0    | Installed dependency paths valid; no compatible secure parent update established                                                               |
| `git diff --check`, `git status --short`                    | 0    | Whitespace clean; owner work remains uncommitted, archives retained                                                                            |

The full suite checks local D1 migration repeatability/history, actual health JSON, SIWE/ownership, registry quarantine, payment replay/concurrency/recovery, desktop/mobile browser behavior, production route isolation, upstream denial and release security. No prior assertions were weakened. The focused run recorded supported 33, verify 29, settle 27, reconcile 4, chain-fixture 38 and **upstream 0** HTTP calls; these are test counters, never production metrics. The full payment suite also exercises its pre-existing loopback HTTP upstream cases, not external upstreams.

Existing non-fatal build warnings remain: Vite externalizes `node:worker_threads` from the installed ox dependency; Foundry emits existing test naming/typecast and hashing-efficiency lint notes. Neither resulted in a failed command. No new vulnerability is declared fixed. Actual audit exit 1 remains a release blocker, not a passing check.

Evidence logs are ignored local `.wrangler/pilot-admission-*` artifacts, including `targeted-final.log`, `regression.log`, `forge-test.log`, build/lint/Functions/bundle logs and full/production audit JSON. No credentials or signing keys are logged.

**Verdict: LOCAL READY FOR OWNER REVIEW; PRODUCTION READINESS BLOCKED; OWNER AUTHORIZATION REQUIRED.** SG-07 remains IN PROGRESS. No Git mutation, deployment, production D1/Cloudflare/DNS operation, live RPC/CDP/upstream call, production signing, transaction broadcast, ETH/USDC spending or Builder Code work occurred. The only local signing is the existing isolated unfunded test authorization/SIWE fixture mechanism. Stop for owner/ChatGPT review before production admission implementation or any live test.

## Subsequent settlement-admission architecture continuation

See [SG-07_SETTLEMENT_ADMISSION_REPORT.md](SG-07_SETTLEMENT_ADMISSION_REPORT.md) for current evidence and exact changed files. It adds sealed, one-use local pre-admission candidates backed by the existing durable review journal, exact nonce binding, reconciliation checkpoint validation and atomic conflict denial in receipt/fulfillment claims. Forward migration 0008 blocks journal-ID replacement; 0001–0007 remain unchanged. Prior test counts above are historical. The narrower official CDP auth/Foundation HTTP composition is a tested import/build candidate, not installed dependency remediation or approved production authentication. All production confirmation and paid-route gates remain disabled.
