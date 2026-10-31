# SG-05 — x402 USDC Gateway and Durable Payment State

Status: **IN PROGRESS, ready for local source/evidence review. Production payments remain BLOCKED.** SG-00 through SG-04 are owner-approved complete. No canonical checklist was modified and SG-06 was not started. All successful payments described here are **LOCAL SIMULATION ONLY**, not Mainnet transfers.

## Inspection and preserved baseline

Confirmed `/home/deseti213/projects/signalarc-gate`, branch `main`, HEAD `326cde9`. Initially only the three owner review archives were untracked; none was modified, extracted, staged or deleted. Inspected applicable instruction locations, historical SG-02/SG-03/SG-04 and compatibility reports, environment/configuration, native Pages routing, auth/ownership, schema, local harness, registry source/tests/mapping, manifest/lock, installed SDK exports/types/implementation and current audit. Canonical V2 rule/roadmap files and applicable AGENTS.md were not present locally; the owner's supplied constraints govern this task.

Read-only diff confirms no changes to production Functions, SG-03 server/auth/resource APIs, frontend, shared validators, `0001_sg03.sql`, contracts, Wrangler, package lock, historical reports or CI workflow. The existing health response is unchanged. Only the SG-03 runner's expected applied-migration list changes to include the forward migration; its previous assertions/check groups are preserved.

## Files

Created:

- `migrations/0002_sg05.sql`
- `scripts/sql-statements.mjs`
- `server/sg05/bounds.ts`
- `server/sg05/clock.ts`
- `server/sg05/gateway.ts`
- `server/sg05/protocol.ts`
- `server/sg05/reconcile.ts`
- `server/sg05/registry.ts`
- `server/sg05/store.ts`
- `server/sg05/upstream.ts`
- `tests/sg05/handler.ts`
- `tests/sg05/run.mjs`
- `tests/sg05/tsconfig.json`
- `docs/SG-05_REPORT.md`

Modified:

- `package.json`: `test:sg05`; append it to `npm test` so the existing CI quality command exercises the local proof.
- `scripts/local-runtime.mjs`: reviewed trigger-aware migration boundaries, optional isolated fixture module/bindings, migration selection for forward-upgrade testing, and safe reuse of a free local port/state after intentionally killing only its own process group.
- `tests/sg03/run.mjs`: expect both migration filenames instead of only `0001_sg03.sql`.

No dependency was added, removed or upgraded. Generated logs, metafiles, bundles and state live under ignored `.wrangler/`/contract cache paths. Temporary fixture projects and test databases are cleaned up; owner local application state is not used by the tests.

## SDKs and protocol choices

Actual installed versions: `@x402/core`, `@x402/evm`, `@x402/extensions`, `@x402/svm` **2.28.0**; `@coinbase/cdp-sdk` **1.60.0**; viem **2.57.13**; Zod **3.25.76**. Existing Node **22.22.2**, TypeScript **5.9.3**, Wrangler **4.154.0**, and compatibility date **2026-10-28** remain unchanged. Existing Foundry **1.5.1-stable** and pinned Solidity **0.8.28** are retained without installation or contract changes.

Imports use public Foundation `/server`, `/types`, `/schemas`, `/http`, EVM `/exact/server`, and CDP `/x402` exports. Installed declarations and code were inspected rather than assuming current examples match this lockfile. `x402ResourceServer` registers only `eip155:8453` with `ExactEvmScheme`. The SDK builds requirements using an explicit AssetAmount string, native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, server payout, EIP-3009 and `extra.paymentFlow = 'upfront'`. The SDK's default authorization flow would permit fulfillment before settlement; it is not selected.

The gateway explicitly calls the supported facilitator client's `verify` and then `settle`, in that order, before upstream execution. Upfront flow does not eliminate this additional verification gate. No middleware automatically performs an after-handler settlement, cancellation/refund, second settle or alternate-provider fallback.

`createCdpFacilitatorClient` is the intended compatible CDP factory returning the same official HTTP client interface. Its public export bundles/loads and its missing-credential guard is exercised with **explicit empty strings** and a loopback base URL, suppressing environment credential fallback. No production credentials are requested/read, no JWT is signed, and no authenticated CDP client or live verify/settle call is created. Wiring authenticated CDP remains a release gate, not an implemented/live capability.

## Local request flow

Only a temporary fixture project has `/sg05/*` routes; the ordinary production router is untouched.

1. Unauthenticated buyer GET resolves an actual D1 resource and its merchant wallet. A buyer does **not** need merchant SIWE. Configuration changes still use the unchanged authenticated SG-03 APIs.
2. Validate D1 enabled/configuration plus the explicitly simulated registry provider and binding. Missing/unconfirmed/stale/transferred/inconsistent configurations fail before issuing a payable challenge.
3. Generate a server UUID and random 256-bit request ticket. Persist the ticket hash, exact URL hash, immutable requirements, configuration snapshot/hash/version/revision and expiration in D1. Return HTTP 402 with SDK `PAYMENT-REQUIRED` and a request-specific resource URL. Repeating that exact URL without payment returns the same challenge.
4. Accept either the issued URL or a standard x402 client retry at the original URL. For the latter, extract only a bounded envelope URL for this exact origin/path and resolve its server-issued ticket against D1; all full requirements and URL hashes still must match. Decode a bounded `PAYMENT-SIGNATURE`, check v2, exact requirements and resource metadata, EIP-3009 fields, recipient, amount and validity interval. Claim the authorization atomically in D1.
5. Authoritative **local mock** verification checks a genuine EOA typed-data signature. Only a valid result with the expected payer proceeds. Recheck configuration, advance through verified to settlement pending, and initiate settlement once.
6. Validate the facilitator settlement result. Only success with correct Base network, nonzero transaction-shaped identifier, expected payer, matching amount when supplied, and matching asset/recipient metadata when supplied can be recorded as settled. Optional amount follows installed SDK types; exact signed/request amounts remain fixed. A client transaction hash or `PAYMENT-RESPONSE` header is never proof.
7. Atomically persist settled phase, receipt and one settlement analytics event. All are labeled `local_simulation`; the block field is literal `LOCAL_SIMULATION_ONLY`, not an invented block number. Mock hashes derive from an explicitly local simulation string, not a blockchain transaction.
8. Claim fulfillment once, fetch JSON through the injected local transport, recheck resource/registry, and perform a final D1 compare-and-set on revision/binding/ownership. Only then return labeled JSON and SDK `PAYMENT-RESPONSE`.

Every fixture response is private/no-store, has Pragma no-cache and Vary PAYMENT-SIGNATURE, and carries `X-SignalArc-Mode: LOCAL SIMULATION ONLY`. Successful JSON and settlement header extras explicitly identify simulation. No upstream URL, signed authorization, credential or internal exception is returned in errors.

## Forward migration and durable state

`0002_sg05.sql` preserves SG-03 rows/history and the original coarse `status` CHECK. New `phase` is the lifecycle authority; original `status` is only a compatibility projection. In particular, a failed fulfillment can still correctly have coarse status `settled`.

Additions:

- `api_resources.payment_revision`, incremented by a trigger on SG-03 resource edits, including disable/re-enable and same-value writes. Safe-integer constraints prevent counter overflow. No SG-03 API SQL rewrite is required.
- `resource_registry_bindings`: original owner, derived onchain resource ID, optional registry address/block metadata, commitment salt/hash, registry version, provenance, checked time and trigger-maintained generation. No binding/address/confirmation is seeded by the migration.
- Payment attempt identity/fingerprint, buyer, asset/recipient, request and URL hashes, requirements JSON, snapshot/configuration revision/generation/version/hash, expiry, operation deadline, failure code and evidence kind.
- Global unique authorization identity and fingerprint indexes, recovery index, phase-transition trigger, allowed-initial-phase trigger and immutable claimed-identity trigger.
- Receipt provenance, authorization/configuration binding and sanitized settlement JSON; analytics attempt FK, provenance and unique attempt/event index.

Existing attempts default to **`legacy_unreconciled`**, not newly trusted successes. Existing receipts/analytics default to `legacy_unconfirmed`. No historical payment evidence is invented or reclassified as confirmed.

Permitted transitions (also enforced by D1):

| From                                                                     | Allowed next phases                                                |
| ------------------------------------------------------------------------ | ------------------------------------------------------------------ |
| created                                                                  | verifying, rejected, failed                                        |
| verifying                                                                | verified, rejected, failed                                         |
| verified                                                                 | settlement_pending, failed                                         |
| settlement_pending                                                       | settled, failed, settlement_unknown                                |
| settlement_unknown                                                       | settled, failed, only through authoritative reconciliation service |
| settled                                                                  | fulfilling, fulfillment_failed                                     |
| fulfilling                                                               | fulfilled, fulfillment_failed                                      |
| rejected / failed / fulfilled / fulfillment_failed / legacy_unreconciled | terminal; no reset to payable                                      |

Receipt/event insertion and settled transition share one native D1 batch transaction. Real SQLite trigger faults test rollback, not a mocked database result. Transaction hash and attempt receipt uniqueness prevent conflicting credits. Reconciliation races cannot create duplicate receipts/events.

The local loader now uses explicit `-- signalarc:statement` boundaries for this trigger-bearing migration, retaining the reviewed legacy splitter for `0001`. It does not claim to parse arbitrary future SQL. Filename/digest ledger checks and transactional batches are retained. Tests first apply SG-03, insert a clearly labeled legacy fixture, then apply SG-05 and verify preservation/idempotence. The standalone CLI also applied both migrations against an isolated directory and correctly skipped them on the second run. No remote D1, fabricated database UUID or remote migration was used.

## Idempotency, replay and interruption

The canonical request identity is the exact server-issued URL/ticket, also recoverable from the validated payment envelope when a client retries the original URL, not a client-supplied merchant/price or arbitrary idempotency header. Ticket and URL hashes prevent guessing/rebinding an attempt. Repeating an unpaid initial base URL may create another unpaid challenge; the paid authorization still cannot settle twice.

Authorization identity is SHA-256 over canonical `[network, asset, payer, EIP3009 nonce]`, normalized for address/hex case. Its unique index spans merchants/resources. A separate fingerprint hashes canonical authorization **and signature**. This permits key-order/case normalization while ensuring a forged replacement signature cannot resume an already-settled request. No raw signed payload/private key is stored in D1.

The atomic created→verifying update claims both unique identities. Only its winner owns subsequent workflow cleanup; a losing concurrent HTTP request cannot fail the winner's attempt. Verified→pending is another CAS. Pending/unknown/terminal attempts cannot call settle again. Six concurrent requests produce exactly one verification, settlement request, receipt, upstream call and protected response.

Recovery moves expired verification/verified work to failed (settlement was never initiated), interrupted pending work to unknown, and interrupted fulfillment to fulfillment_failed. It does not reclaim a settlement lease or charge again. Unknown reconciliation requires a **server-injected authoritative lookup**, matching identity/network/asset/payer/payee/amount; request-supplied hashes or declarations are ignored. The only lookup implemented is the isolated Node simulator ledger. No nonexistent CDP status endpoint is assumed. Trusted proof can resolve unknown to settled or definitely not submitted; missing/conflicting evidence stays unresolved.

The test kills only its own Pages process group immediately after the mock receives settlement, restarts on the same free loopback port and persistent D1 path, recovers pending→unknown, reconciles and fulfills once without another settle. This demonstrates persistence beyond an in-memory mutex.

**Exactly-once limits:** D1 can enforce a unique settlement initiator and a single response-release claim, not a distributed atomic transaction with a facilitator or upstream. A crash may occur before/after an external side effect or HTTP delivery. `fulfilled` means the server committed the one release decision, not proof the buyer received the bytes. Lost responses cannot replay content. Already-started upstream execution can continue despite an aborted client. Settled-but-unfulfilled attempts retain receipts and require incident handling; no automatic refund, new payment, resettlement or upstream retry exists. Throughput, rate/retention budgets and reconciliation operations need production review.

## Registry consistency and authorization

SG-04 mapping is implemented unchanged: UUID bytes16 + **original** registering owner + Base chain/domain ABI hash; commitment uses its documented domain, resource ID, normalized upstream URL hash, JSON type, response limit, redirect-error code and salt. The known independent Solidity/viem vector is asserted inside workerd. Current owner and payout are distinct.

The local profile accepts only `source = local_simulation`, null registry address/block metadata and explicitly labeled provider observations. Original owner, derived ID, current merchant owner, pending-transfer absence, payout, exact atomic price, hash, uint64 version, enabled state and freshness must match. Binding freshness is five minutes; provider observations thirty seconds; future timestamps over one second are rejected. No successful onchain confirmation or fabricated registry address is inserted. Negative tests deliberately retain an `unconfirmed` binding too.

Snapshot checks occur before claim, after verification, before settlement and before final release. A final D1 CAS also checks current merchant wallet, resource revision/enabled and binding generation. Disable/re-enable ABA is caught even when fields revert to old values. A disable during settlement can stop fulfillment but cannot undo an already submitted transfer: the retained receipt and fulfillment_failed phase make that distinction explicit.

This is **not real registry synchronization**. Production needs the approved deployed address/code, original-owner binding, authoritative confirmed block observations, finality/reorg policy and resource-level transfer reconciliation. An accepted registry transfer must not automatically rewrite a merchant wallet or all its other resources/sessions. Chain state and D1 cannot be checked atomically together; future integration must define that consistency window before public routing.

EIP-3009 cryptographically signs token-domain/from/to/value/time/nonce, **not HTTP URLs or configuration versions**. The gateway binds the first claimed authorization to a server-issued request/configuration and rejects changed terms or later replay, but does not claim cryptographic HTTP intent binding or protection for a stolen, unused bearer authorization with identical financial terms. TLS/header confidentiality and a reviewed compatible intent policy remain security gates; the protocol was not silently changed to a custom signing scheme.

## Parsing, upstream safety and local isolation

Payment headers: 8192 characters; total request headers: 16384; URL: 2048. Paid requests are GET-only with no body. Before SDK/Zod parsing, decoded JSON is bounded to eight levels, 64 entries per collection, 1024 nodes, 128-character keys and 2048-character strings. Typed EIP-3009 fields and canonical integer strings are checked explicitly. Authorizations must already be valid, have over five seconds remaining, and expire within five minutes. Challenges last sixty seconds. All applicable SQL values are bound parameters.

Facilitator SDK calls and service operations use one-second deadlines; responses are bounded to 8192 bytes before SDK schema parsing. Upstream responses require exact application/json media type, successful status, no redirects, configured byte limit (within SG-03's 1024–1048576 range), eight-level/64-entry/1024-node limits and 4096-character strings. Timers cover headers and streamed bodies; readers are cancelled on failure. No buyer cookies, auth header, payment header, arbitrary headers or upstream response headers are forwarded.

The existing HTTPS validator is unchanged and reused. **No production fetch transport is supplied.** Public DNS names can resolve to private addresses or rebind; URL validation and `redirect: manual` alone cannot pin DNS resolution to the actual connection. The local transport maps a validated public fixture URL to a fixed loopback mock; it never allows localhost merchant configuration. No DNS/connection-safe real upstream implementation, public proxy or production fallback is claimed.

Fixture safeguards: generated route exists only in a temporary project; explicit trusted local binding; exact loopback origin; public Pages URL rejection; native D1 metadata `miniflare.db` checked both by wrapper and core; fresh isolated state; fixed loopback facilitator origin. Test-only permanent fetch interception permits only the exact mock origin and `/supported`, `/verify`, `/settle`, `/reconcile`, `/upstream`, `/clock` with expected methods. Redirects/errors are rejected before SDK processing. RPC, CDP, metadata and unrelated destinations are rejected **before native fetch**. There is no production fetch monkey-patch and no fallback URL.

The core requires a server-owned clock capability. During development, freshness checks exposed intermittent wall-clock inconsistencies (one observed future delta was 7306 ms); a SQL-clock alternative did not eliminate the observed issue. Root cause was not established as a specific platform defect. The final fixture supplies an epoch-anchored monotonic clock over the same allowlisted, no-store loopback mock; buyer inputs cannot set it. Strict future/stale checks remain in place. The clock is another **local fixture capability**, not a deployed time service or certification of production clock behavior. Production clock/expiry behavior needs separate runtime verification.

## Verification and actual evidence

| Command                                              | Final result                                                    |
| ---------------------------------------------------- | --------------------------------------------------------------- |
| `npm run build`                                      | PASS                                                            |
| `npm run lint`                                       | PASS                                                            |
| `npm run format:check`                               | PASS                                                            |
| `npm run test:foundation`                            | PASS, 17 checks                                                 |
| `npm run test:compatibility`                         | PASS, 14 checks                                                 |
| `npm run test:sg03`                                  | PASS, 14 groups                                                 |
| `npm run test:sg05`                                  | PASS, 88 checks                                                 |
| `npm test`                                           | PASS, 133 total check groups: 17 + 14 + 14 + 88                 |
| `npm run build:functions`                            | PASS                                                            |
| `npm audit`                                          | **FAIL, exit 1: 19 findings, 7 high + 12 moderate**             |
| `forge fmt --check`                                  | PASS                                                            |
| `forge build`                                        | PASS, existing diagnostics retained                             |
| `forge test -vvv`                                    | PASS, 47 tests, 0 failed/skipped                                |
| Standalone migration helper, isolated `--persist-to` | PASS, both applied; repeat checksums verified/skipped           |
| Production bundle metafile / route inspection        | PASS, no SG-05/test/x402/CDP inputs or paid content             |
| `git diff --check`, read-only status                 | PASS; only listed source/report changes plus preserved archives |

Final SG-05 output, also reproduced through `npm test`:

```text
88 SG-05 checks passed in native Pages/workerd + real local D1. LOCAL SIMULATION ONLY; duplicate settlement initiations: 0.
Local mock HTTP counts: {"/supported":71,"/verify":44,"/settle":35,"/reconcile":4,"/upstream":18,"/clock":1057}
```

Counts are actual local HTTP requests, not users, revenue or settled production volume. The 35 settlement requests are across many distinct positive/negative simulated authorizations; none is a Mainnet settlement. Per-case assertions inspect real D1 rows, exact call deltas, uniqueness, absent content/headers on failure, receipt/event rollback and concurrency outcomes.

Coverage includes standard original-URL paid retries and their duplicate rejection; missing/malformed/oversized payment; v1/unsupported scheme/wrong Base identifier/token/amount/payee; invalid signer and expired/future authorizations; global replay across merchants/resources; concurrency; verification rejection/malformed/HTTP/drop/timeout; definitive/ambiguous/conflicting settlement including wrong response asset/recipient/amount/network/payer, redirect and duplicate transaction receipt; timeout-after-submission reconciliation and forged replacement-signature rejection; authoritative not-submitted reconciliation; stale/disabled/changed resource and transferred/pending/stale registry; SSRF URL classes; all upstream error/size/depth/collection/stream/timeout cases; real D1 trigger faults; illegal transitions, ticket/hash spoofing; actual worker termination/restart; normal app health and production exposure checks.

The production metafile is generated from the real repository Functions tree at `.wrangler/sg05-production-meta.json`, not the payment fixture bundle. Normal-route tests submit forged local flags/payment headers to `/sg05/*` and unknown `/api/*` routes and assert no success/proof headers or paid JSON. Existing frontend behavior remains covered by the foundation and SG-03 Chromium tests.

Earlier failed development runs are not counted as passes: clock-freshness failures above; a conflict fixture initially reused a hash not actually stored as a receipt and was corrected to reuse a known persisted hash; the final binding aggregate initially excluded deliberately unconfirmed negative-test data and was corrected. One parallel lint run inspected a live generated fixture and found its constant guard, plus a real unused import; final lint ran against cleaned generated state after removing the unused import and passed. Existing Vite worker_threads externalization and Foundry naming/bounded-test-cast notes remain nonfatal and unchanged. No advisory/warning suppression was added.

## Dependency findings and release gates

The lockfile/dependency graph is unchanged. Zod 3.25.76 remains affected by **GHSA-mrhx-c7xc-m3w5** (reported affected range `<4.6.6`). Its seven high affected package entries are Zod, abitype, CDP and the four x402 packages. Selected SDKs still depend on Zod 3-compatible ranges; no evidence-backed compatible remediation was applied. Bounds are mitigation, **not a fix**.

The current audit also reports **GHSA-g3hv-75wg-m249**, minimatch glob amplification (`<11.0.1`), propagated through twelve moderate ESLint/TypeScript tooling entries. These findings were not in the old seven-high summary; they remain visible. No package was added to cause this graph change, no forced repair or unsupported override was used, and the CI audit job remains failing. npm's printed force-fix suggestion was not executed.

Production release remains blocked on dependency remediation/review; genuine registry address/state/finality synchronization; authenticated CDP/JWT/permissions validation; authoritative production reconciliation; DNS/connection-safe upstream transport; reliable production clock/expiry behavior; TLS/origin/header confidentiality; operational rate/storage/retention/free-tier budgets; and review of paid-but-unfulfilled handling and the unavoidable distributed consistency window. Remote D1, real wallet/provider payment behavior, real USDC balance/nonce checks and blockchain settlement are unverified. No independent security audit or production readiness is claimed.

## Non-executing Base Mainnet smoke-test plan

**Do not execute this plan under the current authorization.** All gates above must first pass and the owner must separately authorize the exact actions immediately before execution.

1. Pin Base Mainnet 8453 / `eip155:8453`, official native USDC above, reviewed build/migration digests, real approved registry address/code, confirmed resource ID/version/hash, merchant owner and payout. No substitute token/network/address or unconfirmed deployment.
2. Owner selects/controls merchant and buyer addresses. The buyer holds the selected exact atomic USDC amount; private keys remain in their wallets. Confirm the actual gas payer, facilitator sponsorship/fees/limits and applicable permissions. CDP key ID/secret must be provisioned by the owner only in server secret bindings with approved verify/settle access; never VITE variables, logs or this repository.
3. Owner explicitly approves the exact resource, USDC amount, minimum funding required for that chosen amount, maximum USDC per attempt/total, maximum ETH/gas cost, any facilitator credit/cost cap, maximum attempt count and time window. None of these budgets is invented here. Verify sufficient balances and fee headroom against those limits without broadcasting. If billing or gas sponsorship is uncertain, stop.
4. Enable only the separately reviewed intended surface for the approved window. Capture an unpaid 402 and exact requirements, buyer wallet consent/signature without leaking it, attempt/authorization hashes, facilitator verify decision, settlement result, and the durable phase/receipt. Submit only after the owner confirms the immediate execution approvals and spending caps again.
5. Require transaction/explorer evidence on Base: matching hash, successful canonical receipt/block, required finality, official USDC Transfer from buyer to the exact merchant payout/atomic amount and appropriate authorization consumption. Compare authoritative facilitator evidence with D1 binding/receipt and the one fulfillment decision; a client hash or HTTP 200 alone is insufficient. Record actual gas/fee evidence, not local estimates.
6. On timeout, lost response, mismatch, reorg, duplicate or upstream failure, close the paid surface, retain state/evidence and mark unknown or fulfillment failure as appropriate. Never automatically resettle or request another charge. Use the approved authoritative reconciliation process; only a confirmed outcome may resolve uncertainty. Escalate paid-but-unfulfilled handling to the owner. Refunds, contract changes, transfers or additional paid attempts require separate approval; this registry/gateway has no custody/refund mechanism.
7. Roll back exposure/configuration safely by closing routing first, not deleting payment history or resetting nonce/idempotency records. Any onchain disable/configuration transaction, deployment, secret/account change or production migration requires its own explicit authorization. Review evidence before proceeding further.

Required owner decisions now: review this local source/evidence and the at-most-once delivery tradeoff; confirm the proposed registry binding/reconciliation interface and clock capability; decide how production security/dependency/transport gates will be addressed. No approval is requested to run a live payment now. **SG-05 stays IN PROGRESS; SG-06 is not started.**

No Git mutation/publication, public payment endpoint, public testnet, contract deployment, blockchain broadcast, live facilitator verify/settle, production credential access, real ETH/USDC spending, remote D1/Cloudflare/DNS operation, paid service or unrelated repository modification occurred.

## Official sources

- [x402 facilitator and headers](https://docs.x402.org/core-concepts/facilitator), [exact EVM scheme specification](https://github.com/x402-foundation/x402/blob/main/specs/schemes/exact/scheme_exact_evm.md). Installed 2.28.0 types/source, including flow flags, optional settlement amount and HTTP behavior, take precedence over examples from a different version.
- [CDP production configuration](https://docs.cdp.coinbase.com/x402/seller/production-configuration), [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator). Compatibility does not establish live authentication or commercial entitlement.
- [Cloudflare Fetch behavior](https://developers.cloudflare.com/workers/runtime-apis/fetch/), [D1 batch transactions](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch). No claim that ordinary hostname validation pins DNS/connection addresses.
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249), as reported by the actual current npm audit.
