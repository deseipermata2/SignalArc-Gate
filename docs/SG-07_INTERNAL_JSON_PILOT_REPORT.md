# SG-07 secure internal JSON pilot

**Local pilot ready for owner review; production payment release remains BLOCKED. SG-07 remains IN PROGRESS.** This is the explicitly requested local owner-controlled JSON experiment. It does not change the production arbitrary-HTTPS product or admit simulated evidence as Mainnet proof.

## Preserved checkpoint

Read-only Git inspection confirmed `main` at **6af7855**. The previous payment-hardening changes and `docs/SG-07_PAYMENT_COMPLETION_REPORT.md` were already uncommitted; all were preserved. Twelve untracked review archives remain intact. No applicable AGENTS.md or canonical V2 rules/roadmap files were available in this checkout; the supplied restrictions govern. Existing gateway/registry/auth/D1 schema, reports, local harness and prior fingerprint/CAS/recovery/adapter changes were inspected before implementation.

Owner-reported deployed registry/Alchemy/Pages/D1 success is preserved as existing evidence. No live RPC, production API, CDP, merchant upstream, Cloudflare, DNS or remote D1 operation was performed here. No production wallet or transaction signing/broadcast, funds, credentials, Git mutation, Builder Code or grant work was used. Existing tests use isolated unfunded cryptographic/SIWE fixtures only.

## Smallest local design

`server/sg07/internal-json.ts` implements one fixed owner-controlled handler: a **resource payment configuration document**. It returns the exact server resource UUID, Base network, native USDC asset, atomic price, payout, registry version and public configuration commitment. The document describes real captured D1 configuration, with `localSimulationOnly:true`; it contains no invented activity, receipts or revenue. Private upstream URL, salt, buyer authorization, signature and session data are excluded.

The module has no Fetch, DNS, socket, service-binding or proxy capability and accepts no arbitrary handler callback. The existing HTTPS upstream URL remains a commitment identifier, compared as a string and never dereferenced. This permits a meaningful internal JSON delivery test without claiming arbitrary merchant HTTP is SSRF-safe.

The factory requires explicit local opt-in, local environment, loopback HTTP origin/pages context and actual `miniflare.db` metadata. Its captured manifest is copied, bounded and deeply frozen. It recomputes the owner-namespaced resource ID, salted configuration commitment and complete snapshot hash, and requires enabled Base-only resource configuration and `local_simulation` binding with no real registry address. Read-only RPC observations and production confirmation labels cannot substitute for that local profile.

The pilot composes the existing `UpstreamAccess` interface and `createLocalGateway`; the gateway/state machine/production routing are not replaced. Eligibility binds exact resource, merchant, owner, revision, binding generation, configuration and snapshot hash. The normal gateway validates the simulated registry owner/payout/price/version/enabled/pending-transfer state before a payable challenge and again around settlement/delivery. No paying buyer is incorrectly required to authenticate as the merchant.

## Durable delivery boundary

The handler independently requires a bound attempt ID and performs prepared D1 joins before constructing the JSON response:

- Attempt phase is `fulfilling`, with local-simulation provenance.
- An existing local receipt binds the same authorization, merchant/resource, network/asset, atomic amount, buyer, payout, configuration version/hash and exact captured snapshot.
- Receipt transaction metadata matches its bounded, validated local settlement body.
- Current resource remains enabled with the same payment revision, and the binding remains local with the same generation.
- Only GET, no body/credentials, manual redirects, no-store and exactly an Accept JSON header are accepted. Cancellation denies delivery.

No receipt or payment state is created by this handler. The existing gateway owns the atomic settlement and fulfillment claims, issued request ticket, authorization replay indexes, receipt/analytics batch and final configuration recheck. It releases JSON only after successful validated local settlement, persisted receipt and the final fulfillment CAS. An original-URL x402 retry may provide the bounded issued envelope, but the gateway still validates its exact server ticket, URL/requirements and D1 identity before delivery.

The transport factory is scoped to one resource/attempt; no shared mutable last-request permit is used. Six concurrent paid requests result in one settlement initiator, receipt and handler delivery. Replays return no content. The owner-controlled entry is captured once; merchant configuration changes invalidate the snapshot rather than silently rewriting payment requirements.

## Isolation and failure handling

Only the isolated SG-05 fixture can explicitly register a pilot snapshot. The fixture-only `sg07_internal_pilot_fixture` table stores its captured approval/fault/call accounting in temporary local D1; it is not an application schema or production migration. Fault controls and manifest corruption probes are inaccessible through deployable Functions. There is no public pilot registration or payment route and no public request flag selecting a transport.

Tests cover unpaid/direct-handler, extra credential header, wrong merchant, missing opt-in and public-origin denial; no direct call can obtain the internal JSON without its paid local attempt. Wrong registry owner, payout, price or simulation provenance rejects before a payable challenge. Attaching a different merchant/resource manifest fails even with the same URL identifier, price and payee.

Simulated handler error, timeout or configuration mutation after settlement preserves the receipt and coarse settled status, marks delivery `fulfillment_failed`, and never charges again. Unknown settlement creates no receipt/content/handler call; workerd restart retains it. Only the existing internal **local-simulation ledger** reconciliation resolves that fixture, after which one delivery occurs without a second settlement. This is not a real CDP reconciliation service. Client receipt of the HTTP response cannot be made atomic with settlement/D1; production support/retry/dispute policy remains required.

Production arbitrary upstream denial is untouched. Tests inspect the actual public Functions graph for internal pilot/payment/test imports and probe forged public pilot routes. The focused run's actual mock HTTP counts were supported 10, verify 7, settle 7, reconcile 1 and **upstream 0**; these are test counters, not production usage metrics. All successful receipts remain explicitly LOCAL SIMULATION ONLY.

## Verification and reproducibility

New command: `npm run test:internal-json`. It runs the existing native workerd/D1 harness with `--internal-json-only`, retaining migration/guard/production-isolation checks plus the fifteen new pilot groups. Default `npm run test:sg05` and `npm test` still run every previous case and the pilot. The old cases are wrapped solely to support the focused option; the full default assertions remain.

Focused result: **19 checks passed**. Full payment suite result: **148 checks passed** (the existing 133 plus fifteen pilot groups). Full aggregate: **439 application checks passed**, preserving the previous 424 and adding fifteen pilot groups.

| Command                                                 | Actual exit/result                                                                                                                                 |
| ------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:internal-json`                            | 0; 19 focused native workerd/D1 checks, upstream HTTP count 0                                                                                      |
| `npm run test:sg05` via `npm test`                      | 0; 148 payment checks                                                                                                                              |
| `npm test`                                              | 0; 439 = 17 foundation + 14 compatibility + 14 SG-03 + 148 SG-05 + 20 SG-06 + 75 SG-07 + 43 registry admission + 32 upstream + 76 release security |
| `npm run build`, `npm run lint`, `npm run format:check` | 0                                                                                                                                                  |
| `npm run build:functions`                               | 0                                                                                                                                                  |
| `npm run check:bundle-boundary`                         | 0; 463 Functions / 1,781 browser inputs; no internal pilot, payment/test SDK, Zod or minimatch inputs in public bundles                            |
| `forge fmt --check`, `forge build`, `forge test -vvv`   | 0; 47 passed, 0 failed/skipped                                                                                                                     |
| `npm audit`                                             | 1; 5 high + 12 moderate                                                                                                                            |
| `npm audit --omit=dev`                                  | 1; 5 high                                                                                                                                          |
| `git diff --check`                                      | 0                                                                                                                                                  |

Actual outputs are local ignored `.wrangler/internal-pilot-*` artifacts. Full suites execute browser/auth/CRUD, migration checksum/repeatability, registry quarantine, independent evidence/review boundaries, clock/fault/restart, upstream denial and production mock-isolation checks. No failing audit was suppressed. No compiler comparison, live provider call or previous phase was restarted.

Resolved development failures: the installed Workers RequestInit type does not expose browser `credentials`; the pilot now rejects any supplied credentials property using a runtime property check. The initial full payment run also exposed a timing-dependent existing mock: a 1.5-second delayed response could be processed before the workerd deadline callback, unexpectedly returning success. Verification/settlement timeout fixtures now withhold response headers until cancellation instead of relying on timer ordering. Timeout assertions remain unchanged. This fixture correction does not establish a production trusted clock or remove the existing clock release gate.

## Dependency security

Fresh npm audits still report **17 affected entries (5 high, 12 moderate)** and production-only **5 high**. Current public metadata still selects CDP **1.60.0** with Zod `^3.25.76`, Kit `^5.5.1` and x402 peers; [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0) requires Kit `>=8.0.0`. Latest [config-array 0.23.5](https://registry.npmjs.org/@eslint/config-array/0.23.5) remains on minimatch `^10.2.4`. The previous report's CDP/abitype/SVM Zod-3 and minimatch parent-chain blockers therefore remain; no supported compatible fix was identified. See [CDP metadata](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0) and the detailed [payment completion review](SG-07_PAYMENT_COMPLETION_REPORT.md).

No dependency versions, lockfile, overrides, audit policy or SDK/provider were changed. Package.json adds only a useful test script. The new local module imports existing SDK validation code solely in the local bundle; deployable browser/Functions graphs still exclude payment SDKs, Zod and minimatch. Their absence from current public input graphs is not remediation of installed vulnerabilities, and bounds are not a substitute for upstream security fixes.

## Changed files and approval boundary

Files created by this bounded task:

- `server/sg07/internal-json.ts`
- `docs/SG-07_INTERNAL_JSON_PILOT_REPORT.md`

Files modified by this task, preserving the prior uncommitted edits:

- `tests/sg05/handler.ts`
- `tests/sg05/run.mjs`
- `package.json` (test script only)
- `docs/SG-07_REMEDIATION_REPORT.md`
- `docs/RELEASE_CHECKLIST.md`

No new production schema, service binding or credentials are needed for this **local** internal handler. Existing seven migrations remain unchanged and execute only against isolated test D1. No migration 0007 was applied remotely.

Production use requires separate approval of the exact fixed handler and server-controlled manifest (merchant/resource/owner, payout/atomic price, registry version/hash and policy revision), including revocation that advances the payment revision. A single reviewed server-owned manifest could avoid a new handler-specific database schema or service binding. Any dynamic operator registration schema/control API must be proposed and reviewed first; this test table is not that design. The owner has authorized a local pilot, not a production narrowing of the arbitrary-merchant HTTPS product.

The next smallest bounded task is to review the **production manifest and trusted registry/settlement admission contract for this fixed-handler pilot**, including revocation and unknown-settlement recovery. The existing confirmation prohibition must not be bypassed. Dependency remediation, real resource registration/admission, actual CDP execution/receipt shape, canonical evidence/clock/provider policy, paid-but-unfulfilled recovery, production migration/secret/publication approvals and exactly one separately budgeted Mainnet test remain mandatory gates. Successful local JSON delivery does not clear them. Do not enable a public paid route or start another phase.

## Subsequent local admission and revocation safeguards

The original results above are historical. [SG-07_INTERNAL_PILOT_ADMISSION_REPORT.md](SG-07_INTERNAL_PILOT_ADMISSION_REPORT.md) records the continuation: exact immutable server manifest, durable one-way local revocation and revision invalidation, restart/replacement defenses and canonical native-USDC fixture verification before receipt persistence and delivery. The same no-network JSON handler and disabled production boundary remain. No production schema or automatic resource/payment confirmation was introduced.
