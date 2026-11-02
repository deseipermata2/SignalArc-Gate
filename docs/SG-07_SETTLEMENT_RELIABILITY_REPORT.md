# SG-07 CDP facilitator and settlement reliability review

**SG-07 IN PROGRESS. Production payments, real upstream fulfillment and Mainnet launch remain BLOCKED.** Local simulation is not live settlement, independent chain evidence or production certification.

## Baseline and inspected boundaries

Read-only inspection confirmed branch `main`, HEAD `6c0b591`, matching the owner checkpoint. Eleven untracked review archives were present and preserved. No applicable AGENTS.md or canonical V2 project instructions were found locally; supplied constraints govern. Reviewed SG-05 protocol/gateway/store/reconciliation/clock/registry, SG-07 facilitator/registry/admission/upstream, public routing, migrations 0001–0005, existing local tests and current security/release documentation. No previous phase was restarted.

The production Functions router still excludes these payment/readiness modules. There is no new payment, reconciliation, recovery, clock or fixture activation route in deployable Functions. Actual native Pages/workerd and isolated local D1 execute the tests; outbound test traffic is restricted to the fixture's loopback server. RPC, CDP and arbitrary external targets are rejected before native transport. Local typed-data signatures are genuine cryptographic tests using ephemeral unfunded keys confined to Node memory; no blockchain transaction is signed or broadcast.

## Findings and narrow remediation

| Finding                                                                      | Affected path                                                                                                                                       | Correction                                                                                                                                                                                             |
| ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Contradictory verification could be accepted                                 | SG-05 gateway checked `isValid` and payer, but ignored a simultaneous `invalidReason`                                                               | Shared runtime verification validator rejects contradictory error reason/message and malformed payer/object; used by SG-05 and SG-07                                                                   |
| Persisted verification/operation deadline was not part of the submission CAS | `PaymentStore.advance` could move verifying→verified→pending after the persisted lease/challenge expired, unless recovery had already changed phase | Both forward pre-settlement transitions require live operation deadline, live challenge expiry and `updated_at <= now` in the same SQL update. Claim also rejects a clock older than the persisted row |
| Backward positive integer clock readings passed basic clock validation       | Payment clocks validated range/type only                                                                                                            | Payment-scoped monotonic clock wrappers reject backward readings; persisted CAS timestamp checks survive a fresh clock capability. This is not a production clock authority                            |
| Authorization could expire while awaiting the pending-claim callback         | SG-07 adapter checked freshness before awaiting claim                                                                                               | Recheck immediately after claim, inside the conservative unknown-outcome boundary; clock failure/expiry cannot invoke settlement                                                                       |
| Contradictory local recovery evidence could resolve to failed                | `reconcileUnknown` accepted `not_submitted` alongside settlement evidence                                                                           | Validate bounded runtime fields/provenance/disposition and reject contradictory not-submitted evidence and invalid claimed settlement without changing unknown state                                   |
| Receipt serialization discarded returned optional evidence fields            | `PaymentStore.settle` replaced all `extra` metadata with the simulation label                                                                       | Preserve validated returned metadata and add the explicit local label. Persistence/header tests compare the complete JSON and retain asset/recipient                                                   |

Additional persistence hardening: the store independently validates settlement fields, requires local evidence provenance when committing settlement, refuses a pre-existing receipt, and gates receipt/event inserts on the preceding statement's successful `changes()` result inside the atomic D1 batch. Losing a CAS cannot create a new receipt/event from an already-settled phase. Existing receipts are never replaced. This closes a defensive gap in the old SQL; no normal-path partial-commit exploit is claimed, since the existing batch already provided atomic rollback on SQL errors.

Runtime response checks accept optional amount/recipient/asset only when they match if provided. The installed settlement interface does not require all those fields, so missing optional fields are not invented. A coherent facilitator report still does not prove independent onchain finality. Nulls, arrays, incorrect types, zero/missing hashes, mismatched network/payer/amount/asset/recipient and contradictory error fields never authorize delivery.

No migration is needed: existing unique authorization/fingerprint/receipt/event indexes, transition trigger, immutable claimed identity and revision/generation triggers support these SQL corrections. Historical migrations and their checksums remain unchanged. No contract, merchant API, frontend, dependencies, deployment configuration or production transport behavior changed.

## Traced request flow and permitted transitions

1. Resolve server D1 resource/merchant/binding and local registry snapshot. Require upstream eligibility before SDK discovery or a new payable challenge.
2. Create a durable attempt and x402 v2 402 challenge for exact Base `eip155:8453`, native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, exact atomic amount and authoritative payout. Request ticket/URL hashes and full requirement/configuration snapshot are persisted.
3. Bound and parse PAYMENT-SIGNATURE, match exact server requirements/resource, validate authorization fields/expiry. Derive globally unique authorization identity from chain/token/payer/nonce and a payload/signature fingerprint.
4. SQL claim changes created→verifying once. Unique indexes reject reuse across resources/merchants; a losing request cannot call settlement.
5. Verify through the loopback facilitator, validate response and recheck resource/owner/registry/upstream snapshot. Verification alone grants no content.
6. SQL transitions verifying→verified→settlement_pending require current resource revision, owner and binding generation plus unexpired durable operation/challenge deadlines. Pending is committed before calling settle.
7. Call direct facilitator `settle` once. Transport errors, timeout, HTTP errors, malformed/contradictory/pending reports remain settlement_unknown. The specially labeled local fixture's explicit rejection before submission may become failed; this is not a real CDP non-submission certificate.
8. Valid local settlement report is committed in one D1 batch with receipt and deduplicated analytics. Failed persistence leaves pending/unknown, never a fabricated receipt or content response.
9. Revalidate the resource, atomically claim settled→fulfilling, load persisted local receipt, fetch through the isolated upstream capability, revalidate again, then CAS fulfilling→fulfilled before releasing JSON with PAYMENT-RESPONSE and private/no-store headers.
10. Delivery/configuration failure after settlement becomes fulfillment_failed with coarse status settled and the receipt preserved. No second charge is initiated.

The unchanged migration transition graph remains:

- created → verifying / rejected / failed.
- verifying → verified / rejected / failed.
- verified → settlement_pending / failed.
- settlement_pending → settled / settlement_unknown / failed.
- settlement_unknown → settled / failed, only through internal local evidence reconciliation.
- settled → fulfilling / fulfillment_failed.
- fulfilling → fulfilled / fulfillment_failed.
- fulfilled, fulfillment_failed, failed, rejected and legacy_unreconciled have no automatic reset to payable.

Recovery marks expired pending operations unknown, expired verifying/verified operations failed before settlement, interrupted fulfilling operations fulfillment_failed, and expired unused challenges failed. An expired submission lease never grants permission to resubmit. A failure to write unknown leaves the durable pending claim intact for later recovery.

## Installed SDK and official protocol evidence

Versions unchanged: CDP **1.60.0**, x402 core/EVM/extensions **2.29.0**, optional SVM **2.28.0**, viem **2.57.13**. Installed public `@coinbase/cdp-sdk/x402` declarations return `HTTPFacilitatorClient`; its factory supports explicit credential overrides/base URL and JWT authentication for verify/settle/supported. No credential was supplied or used. The SG-07 adapter uses only the official return type and injected verify/settle capabilities; the compatibility suite separately loads the actual public helper using its empty-credential guard.

[CDP production configuration](https://docs.cdp.coinbase.com/x402/seller/production-configuration) documents the existing-server helper and exact EVM integration. [CDP facilitator documentation](https://docs.cdp.coinbase.com/x402/seller/facilitator) describes hosted verification and submission. Neither inspected helper declaration nor these pages establishes a durable authorization-status query or client idempotency-key contract suitable for this recovery service. Attempted guessed REST documentation paths for verify/settle were inaccessible; no status endpoint was inferred from them.

The [Foundation facilitator documentation](https://github.com/x402-foundation/x402/blob/main/docs/core-concepts/facilitator.md) warns that settlement timeouts are indeterminate and documents a pending-store-based retry in its higher-level server flow. Its in-memory default is not a durable multi-replica guarantee. This is not proof of CDP's retention, routing or reconciliation guarantees. Installed source confirms `x402ResourceServer.settleWithPendingRetry` can call settle a second time; **this gateway does not call that path**. It uses `HTTPFacilitatorClient.settle` directly. No automatic retry was added.

Installed core 2.29.0 HTTP client has one direct verify/settle fetch, a 1 MiB control-plane body cap, a default 90-second request timeout and automatic redirect following; getSupported has bounded 429 retries. The local client uses timeoutMs 1000 and the fixture intercepts before decoding to enforce 8 KiB and manual redirects. The SG-07 returned-object checks do not retrofit those tighter raw HTTP controls onto a real CDP client. An outer timeout does not prove the SDK/remote operation stopped. Real JWT timing, raw-response structure bounds, redirect restrictions, cancellation and live behavior remain release blockers.

No supported authoritative production lookup or durable CDP idempotency assurance was established. Do not apply unrelated Coinbase Payments API idempotency conventions to x402 or presume Foundation facilitator memory is shared/durable. A later supported contract must be reviewed against exact installed interfaces before any live use.

## Recovery, consistency and evidence limits

The local lookup is an internal injected test-ledger capability, not a CDP status API. Both the persisted attempt and returned evidence must have local simulation provenance; legacy/untrusted attempts cannot be promoted. Exact identity/network/asset/payer/payee/amount must match. Unknown evidence does not modify state. Valid simulated settlement can CAS unknown→settled; explicit fixture-only non-submission can CAS unknown→failed without enabling a new charge. Concurrent reconciliation has one winner; duplicate/late calls cannot replace a receipt. Conflicting evidence must not be interpreted as real confirmation.

Real uncertain settlement needs an authorized operator, approved independent Base observation source, canonical transaction receipt/status/logs/finality, native-USDC authorization consumption and exact nonce/payer/payee/amount, plus verified facilitator submission evidence correlated to the durable attempt. A transaction hash is only a locator. Absence of a receipt or elapsed time is not proof of non-submission. Conflicting sources require quarantine/manual escalation, not a first-response production authority. There is no production reconciliation/admission service, operator audit workflow, refund mechanism or dispute implementation in this task.

Actual local tests kill the Pages process during pending settlement and during reconciliation, retain the same D1 persistence directory, start a fresh runtime and apply no duplicate migrations. Concurrency tests exercise independent per-request store instances against the same D1 database, not merely an in-memory lock. They do not prove production multi-region read consistency, session/bookmark selection, stale replicas, backup/restore, remote availability or every infrastructure failure mode.

D1 cannot transact atomically with a facilitator or upstream. A claim committed before submission may survive a crash that occurred before sending, and a successful external settlement may have no locally persisted response. Both require evidence-based reconciliation, not a fresh charge. At-most-one settlement initiator and at-most-one release claim under the tested database assumptions are not exactly-once remote execution or proof the buyer received bytes.

## Clock and paid-but-unfulfilled policy

Payment-scoped monotonic validation rejects backwards integer readings; invalid values or failures deny progress. Persisted expiry/updated-at/deadline predicates prevent a fresh worker from ignoring an expired prior verification lease. A forward jump can expire eligibility/authentication; a backward clock can delay recovery but does not create a second pending claim. No durable global trusted epoch, maximum skew, real Workers scheduling/cancellation or restart clock guarantee has been established. These remain blockers, not properties inferred from local fixture time.

A post-submission clock/write failure leaves pending/unknown until the local operator fixture reconciles. Delivery errors retain the receipt and settled status; retries of fulfillment_failed do not settle or release again. Locally, a reconciled attempt still in settled may resume one authorized fulfillment using its original ticket and exact claimed authorization/fingerprint, subject to current configuration. A completed release cannot repeat. There is no automatic recovery endpoint for fulfillment_failed, no response replay cache and no refund. The owner must approve a customer recovery/dispute policy and its authenticated implementation. A committed fulfilled phase means a release decision, not an acknowledged HTTP delivery.

## Adversarial evidence and reproducible commands

`npm run test:settlement-reliability` runs the expanded existing SG-05 and SG-07 suites, rather than a replacement framework. It passes **185 groups**: **122 SG-05** (previously 95) and **63 SG-07** (previously 45), adding **45 groups** plus stronger assertions within existing cases. Tests use actual local native Pages/workerd/D1 and existing isolated facilitator/upstream transports.

New/retained assertions cover:

- Rejected, contradictory, malformed, wrong-payer and timed-out verification; wrong requirements and expired authorization/challenge/operation lease before settlement.
- Concurrent independent request/store claims, global cross-resource/merchant replay denial, no second settle call, and no content before persisted settlement.
- Timeout/drop/5xx/redirect/null/malformed/pending settlement, wrong network/payer/recipient/amount/asset, absent and zero hashes; every ambiguous outcome denies receipts/content and automatic resubmission.
- Persisted pending after a real process kill; operation recovery after a fresh runtime starts with the same D1 files. A separate real process kill during reconciliation preserves unknown state before a later local resolution.
- D1 abort triggers during claim, receipt, analytics and final release; atomic rollback, no invented receipt/event, and retained successful evidence after delivery errors.
- Unknown, wrong identity/network/token/payer/payee/amount/provenance, contradictory non-submission and malformed claimed settlement during reconciliation; concurrent winners, duplicate calls and late conflicting receipt insertion.
- Clock rollback/forward jump/malformed value/failure during verification, late/malformed/backward clocks during settlement, expiry/failure during pending claim, post-submission clock failure and buyer disconnect. Pending/unknown is reconciled without another charge.
- Price/payout/owner/registry/configuration mutations before settlement and before release; disable/re-enable ABA; paid-but-unfulfilled timeout/errors retain receipts and block automatic retries.
- Legacy/untrusted attempts cannot be promoted by a local lookup. Public flag/header/body attempts cannot activate fixtures; actual production bundle inputs exclude simulated gateway/readiness/payment SDK modules. Existing health/auth/dashboard and registry quarantine behavior remain tested.

Dedicated run's actual loopback HTTP counts: **92 supported, 64 verify, 46 settle, 21 reconcile, 25 upstream, 1,535 clock**; duplicate settlement initiations **0**. These are fixture request counts, not transactions, customers, revenue or Mainnet activity. Reconciliation rejects persisted nonlocal provenance before even calling the lookup. All successes retain local simulation labels; no record is admitted as Mainnet-confirmed.

### Intermediate failures and corrections

Development TypeScript checks initially exited 2 because a response type predicate narrowed the existing typed failure branch to `never`; runtime validators now return boolean. A dedicated trial exited 1 because the intentionally failed fixture clock also prevented its inspection control from running; restore the clock before inspecting/recovering persisted state, without changing payment assertions. The first aggregate exited 1 on upstream `clock-rollback` (503 instead of expected 504): moving the new monotonic watermark out of the shared basic helper into payment-scoped wrappers preserved the existing upstream contract and its unchanged tests.

One concurrent dedicated trial returned 402 for an expected-success SG-07 probe and exited 1. It did not release content. The original response lacked diagnostic detail, so its cause is **not established**; no unsupported claim of a load or cryptographic root cause is made. Sanitized fixture error codes/assertion diagnostics were added; subsequent standalone and serial dedicated runs passed. This transient failure remains evidence for owner review and a local stability limitation, not silently erased or used to justify widening timeouts. No prior negative assertions were weakened.

A subsequent aggregate trial also exited 1 when the existing registry fixture had no prepared attempt at its expected verified-phase assertion. A diagnostic rerun passed all 43 registry checks without a functional payment change; the original swallowed fixture error was not captured, so its root cause is not proven. Temporary diagnostics were removed. SG-07 and registry-admission fixtures now use an explicit fixed local simulation epoch (including matching local EIP-712 message dates) rather than treating host wall time as their authority. All expiry/rollback/forward-clock adversarial modes and real hung-operation timers remain active. Registry tests still assert the exact same quarantine, revision and payment states; the SG-05 suite explicitly exercises operation/challenge expiry. These deterministic fixture clocks do not establish a deployed trusted clock or retrospectively prove the source of either transient failure.

## Exact changed-file inventory

- `server/sg05/clock.ts`: payment-scoped monotonic clock capability; existing basic clock contract retained.
- `server/sg05/protocol.ts`: runtime verification/settlement response validation.
- `server/sg05/gateway.ts`: payment clock wrapping, shared verification check, null-safe ambiguous response handling.
- `server/sg05/store.ts`: persisted deadline/time/provenance predicates, validated settlement, CAS-dependent atomic receipt/event inserts, evidence metadata preservation.
- `server/sg05/reconcile.ts`: bounded runtime evidence validation, provenance and conflict rejection.
- `server/sg07/facilitator.ts`: shared response checks, payment clock and post-claim expiry/failure guard.
- `tests/sg05/handler.ts`: isolated expiry, provenance, persistence and analytics fault controls and receipt inspection.
- `tests/sg05/run.mjs`: additional real workerd/D1/cryptographic/fault/restart/receipt assertions.
- `tests/sg07/handler.ts`: adversarial injected client/clock/claim modes, fixed local clock, sanitized diagnostics.
- `tests/sg07/run.mjs`: adapter negative cases and matching deterministic signing epoch.
- `tests/registry-admission/handler.ts`: fixed local fixture clock only; existing assertions unchanged.
- `package.json`: dedicated `test:settlement-reliability` command; dependency declarations unchanged.
- `docs/SG-07_SETTLEMENT_RELIABILITY_REPORT.md`: this review and evidence.
- `docs/SG-07_READINESS_REPORT.md`: bounded continuation and retained blockers.
- `docs/RELEASE_CHECKLIST.md`: settlement/recovery approval boundary.
- `docs/SG-07_LAUNCH_RUNBOOK.md`: non-executing operational evidence and approval requirements.

No package-lock, migration, production Functions, contract, deployment configuration, auth, frontend or merchant API changes. All five migration files were compared byte-for-byte with `git show HEAD:migrations/<name>` and SHA-256 digests were verified; local application/repetition is also asserted by the runtime harnesses. No receipt was deleted or rewritten to repair a failed operation.

## Remaining owner decisions and release verdict

**Local remediation is submitted for owner/ChatGPT review. Production readiness remains BLOCKED; SG-07 stays IN PROGRESS.** Obtain a supported production CDP reconciliation/durability contract or separately review an independent authoritative recovery/admission implementation; approve provider trust/finality and exact evidence requirements. Approve production clock/skew/deadline behavior and D1 primary/read-consistency/recovery/backup strategy, customer paid-but-unfulfilled policy, retention and operational responsibility. Resolve dependency, registry deployment/admission, upstream connection-safety and abuse/capacity gates before any public payment activation.

Credentials, deployments, DNS, remote migrations, buyer/merchant addresses, budgets and any single real Mainnet test require separate later explicit owner authorization. No authorization is inferred from these local tests. No credentials were provisioned/read for live use, no live RPC/CDP/upstream call, Git mutation, transaction, deployment, remote D1 operation, DNS change or spending occurred. All eleven archives remain preserved. No SG-08 work was started.

## Final verification results

Final serial verification completed successfully after the corrections described above. The dedicated command and aggregate were separate invocations. Individual application commands below were executed as the actual `npm run test:*` subprocesses of `npm test`; SG-05/07 also ran separately through the dedicated command. No tests were replaced by status-only mocks.

| Command                               | Final exit | Actual result                                                 |
| ------------------------------------- | ---------- | ------------------------------------------------------------- |
| `npm run build`                       | 0          | TypeScript/Vite production build                              |
| `npm run lint`                        | 0          | ESLint                                                        |
| `npm run format:check`                | 0          | Full repository formatting                                    |
| `npm run test:foundation`             | 0          | 17 checks; health/local D1 preserved                          |
| `npm run test:compatibility`          | 0          | 14 checks; public CDP helper loads in local workerd           |
| `npm run test:sg03`                   | 0          | 14 checks                                                     |
| `npm run test:sg05`                   | 0          | 122 checks; 0 duplicate settlement initiations                |
| `npm run test:sg06`                   | 0          | 20 checks, including authenticated desktop/mobile Chromium    |
| `npm run test:sg07`                   | 0          | 63 checks                                                     |
| `npm run test:registry-admission`     | 0          | 43 checks; conflict quarantine and migration history retained |
| `npm run test:upstream-security`      | 0          | 32 checks; unchanged rollback/timeout assertions              |
| `npm run test:settlement-reliability` | 0          | 185 groups across SG-05/07, 45 groups added above baseline    |
| `npm test`                            | 0          | **325 application groups**, all eight suites                  |
| `npm run build:functions`             | 0          | Native deployable Functions compile; test modules excluded    |
| `npm audit`                           | 1          | **17 affected entries: 5 high + 12 moderate**                 |
| `npm audit --omit=dev`                | 1          | **5 high**                                                    |
| `forge fmt --check`                   | 0          | From `contracts/`                                             |
| `forge build`                         | 0          | Existing compiler/artifact settings preserved                 |
| `forge test -vvv`                     | 0          | **47 passed**, 0 failed, 0 skipped                            |
| `git diff --check`                    | 0          | No whitespace errors                                          |
| `git status --short`                  | 0          | 15 modified files, one new report; eleven preserved archives  |

Final application total: 17 + 14 + 14 + 122 + 20 + 63 + 43 + 32 = **325**. Earlier failed runs are documented above and are not represented as passing. Local serial results do not erase unexplained transient fixture failures or establish production stability.

Fresh audits remain failing with the same Zod/minimatch root advisories and dependency propagation assessed in [the dependency report](SG-07_DEPENDENCY_SECURITY_REPORT.md). No dependency upgrade, override, advisory suppression, forced audit fix or security certification was introduced. Both the unresolved dependency gate and all existing external launch approvals remain mandatory.
