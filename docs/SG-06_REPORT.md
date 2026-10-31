# SG-06 — Dashboard, documentation, security QA and release review

Status: **IN PROGRESS, awaiting owner and ChatGPT review. Recommendation: BLOCKED for production release.** The local implementation is available for source/evidence review. This report does not approve SG-06 completion or authorize SG-07.

## Starting evidence and boundaries

Inspection confirmed `/home/deseti213/projects/signalarc-gate`, branch `main`, HEAD `df30342`, matching the owner's expected baseline. Initial changes were the four untracked SG-02/03/04/05 review archives only; they were preserved. No applicable AGENTS.md or canonical V2 rules/roadmap files were found locally; the supplied requirements govern. SG-02/03/04/05 reports, schemas, authentication/resource APIs, registry interface, payment state machine, isolated runtime harnesses and installed SDK types were reviewed before implementation.

No Git mutation, deployment, remote D1 operation, account/DNS change, funded wallet, transaction broadcast, live facilitator verification/settlement or paid service was used. Test EOA signing occurs with ephemeral, unfunded local keys held only in Node test memory, not browser, logs or persisted credentials. Mock providers and simulated payment evidence do not prove Mainnet execution. Historical phase reports, contracts and earlier migrations remain unchanged.

## Dashboard and read APIs

The existing `/manage` workspace retains injected-wallet connection, Base Mainnet-only network switching, SIWE and merchant CRUD. It now includes authenticated payment reporting with loading, empty, filtered, error/retry and unauthorized states. Session expiry, logout and new sign-in cancel/remove merchant resource/report queries; data is keyed by the server session merchant. Logout hides identity-dependent views immediately. Aborted requests and ten-second browser timeouts avoid stale in-flight cache population. Connected wallet and authenticated merchant identity remain separately visible.

Three native GET endpoints were added behind the existing server session/origin guards:

| Route                     | Behavior                                                                                          |
| ------------------------- | ------------------------------------------------------------------------------------------------- |
| `/api/reporting/summary`  | Actual persisted attempt counts by phase/provenance and consistent local receipt count/atomic sum |
| `/api/reporting/attempts` | Bounded, paginated, owned attempts with requested amount and status                               |
| `/api/reporting/receipts` | Bounded, paginated, owned receipts; untrusted amount/reference withheld                           |

Every query binds the authenticated merchant, joins the resource and verifies matching merchant ownership. A resource filter is independently ownership-checked and unknown/foreign resources return 404. No client merchant identity parameter is accepted. Projections omit authorization fingerprints/raw signatures, session tokens/hashes, buyer identity, upstream URLs, configuration secrets and SQL diagnostics. Errors are sanitized; D1 failures produce a controlled 503. Reads are no-store and vary on Cookie. Mutations still require exact Origin, JSON and the existing CSRF request header; cross-site reads are denied and no CORS permission is introduced.

Filters: `source=all|local_simulation|unverified|verified`, optional owned `resourceId`, UTC `from`/`to`, and attempt-only `phase`. Default is the last 30 UTC calendar days; maximum 90, ending no later than today. Unknown/repeated keys, malformed calendar dates, invalid limits/cursors and unsupported phases fail validation. List limit defaults to 20, maximum 50; UI pages contain 10. Descending `(created_at,id)` keyset cursors include a merchant/route/filter digest. Cursors are navigation state, not signed authorization credentials; ownership is reapplied for every query. They do not guarantee snapshot pagination if records change concurrently.

### Provenance and financial integrity

- An attempt is classified as local only with its local simulation label and Base/native USDC identity; other records are unverified.
- A local receipt additionally must match its attempt's amount, payee, payer, authorization key, config version/hash, network and admissible settled phase, with the existing literal local simulation block marker. Inconsistent/legacy evidence is quarantined as unverified.
- There is **no approved production confirmation admission/reader**. Even an existing `confirmed_onchain` database string would not establish authoritative settlement. `verified.available=false`, count/amount are null, and the verified-only filter returns no records. No fake positive production confirmation fixture was inserted.
- Local receipt totals are explicitly **simulated USDC**, never revenue or Mainnet volume. Unknown outcomes and paid-but-unfulfilled failures have distinct visible status. Unverified receipt amount and transaction reference are null; local references receive no explorer links.
- Attempt counts are persisted attempts, not measured HTTP calls or billable usage. Receipt totals use receipt creation time; attempt counts use attempt creation time. Attempt phase filtering affects the list, not the summary totals, as documented in the quickstart.
- Counts aggregate attempts directly; receipt aggregation never joins analytics events and cannot multiply totals through retries/events. The existing unique receipt-per-attempt constraint rejects duplicates. Currency is an integer string throughout: SQLite integer SUM cast to text, then BigInt conversion/display with six decimals. Overflow fails closed with 503 rather than silently rounding; a narrower window is suggested.

## D1 migration

`0003_sg06_reporting_indexes.sql` adds only `payment_attempts_reporting(merchant_id,created_at DESC,id DESC)` and `payment_receipts_reporting(created_at DESC,id DESC,attempt_id)` indexes. It adds no schema for new product features, fake records, evidence admission or production binding. Existing migration contents/checksums are preserved. Two marker-separated statements are compatible with the local migration helper; neither table history nor SG-05 transition triggers were rewritten.

Actual commands:

```text
npm run db:migrate:local -- --persist-to .wrangler/sg06-migration-check
Local D1 migrations: 0001_sg03.sql, 0002_sg05.sql, 0003_sg06_reporting_indexes.sql
[repeat same command]
Local D1 migrations: already applied (checksums verified)
```

The directory above is isolated local state, ignored by Git. SG-03 and SG-05 tests were updated only to expect the new forward migration; the original SG-05 legacy migration scenario remains intact.

## Security findings and hardening

| Area              | Evidence and limits                                                                                                                                                                                                                                                                                                                                                                                                   |
| ----------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| SIWE/session      | Existing tests reject wrong signer/chain/domain/URI, expired nonce/message/session, replay and concurrent nonce reuse; server revokes logout/re-auth sessions. Hashed D1 tokens, HttpOnly/Strict and Secure `__Host-` HTTPS policy remain. Actual deployed HTTPS and real wallet variants are unverified; contract-wallet authentication is unsupported.                                                              |
| Ownership         | Reporting and CRUD enforce server-derived merchant identity. Cross-merchant resource/report access, invalid cookies and logout-cookie replay are tested against real local D1.                                                                                                                                                                                                                                        |
| Input/headers     | Added total UTF-8 API header cap of 16 KiB and rejection of GET bodies. Existing URL/body, JSON depth, wallet/price and SIWE limits remain. New filter/cursor bounds precede reporting SQL.                                                                                                                                                                                                                           |
| Caching/headers   | Auth API responses add no-referrer, anti-framing CSP/X-Frame-Options and Vary Cookie to existing no-store/nosniff. Static `_headers` sets CSP/self sources, anti-framing, no-referrer, nosniff and disabled camera/mic/location. Health response remains unchanged. Cloudflare `_headers` does not automatically apply to Functions.                                                                                  |
| Payment state     | All 88 SG-05 cases pass: replay/concurrent settlement protection, configuration/owner/registry gates, disabled resource, amount/payee/network mismatches, unknown settlement, real D1 failures and restart reconciliation. A claimed release is not proof the buyer received the response. No financial transition or settlement authority was relaxed.                                                               |
| Slow response     | An initial SG-05 regression exposed a late body accepted when the timer did not reject first (200 versus expected 504). `protectedJson` now also checks elapsed time using its required trusted clock before releasing parsed content. The existing local slow-body test passes. Cause was observed timer scheduling, not proven to be the SDK update. Production clock/transport is still unimplemented and blocked. |
| SSRF              | Existing validator rejects private/local/special-use/IP-literal destinations, credentials, unsafe schemes/ports and redirects. No production connection-safe DNS/actual fetch transport exists. Production has no upstream proxy or public paid gateway. Local mocks are injected capabilities in isolated fixtures only.                                                                                             |
| Logging/analytics | New code does not log signed payloads, cookies or SQL errors. Read models exclude raw authorizations and credentials. Existing test fixture counters are not production activity.                                                                                                                                                                                                                                     |
| Abuse/capacity    | Existing nonce bounds remain, but no enforceable global report/read/request/concurrency limiter, retention policy or production load/cost assessment is implemented. Date and page bounds do not bound all historical aggregation CPU. Cloudflare quotas are not rate-limit protection.                                                                                                                               |

There are non-atomic boundaries between chain/facilitator, D1 and downstream delivery. Unknown settlement must not be automatically charged again. A real registry observer, confirmed evidence admission, authoritative reconciliation, safe clock/egress and owner-approved paid-but-unfulfilled/refund policy remain mandatory release blockers. The dashboard neither resolves those gaps nor creates a way to enable them.

## Dependencies and audit

Environment: Node 22.22.2, npm 10.9.7, TypeScript 5.9.3, Vite 8.3.5, Wrangler 4.154.0, Playwright 1.64.1. No new direct dependencies or framework were added. Lockfile-selected `@x402/core`, `@x402/evm`, `@x402/extensions` changed **2.28.0 → 2.29.0**; their official compatible manifests request Zod ^4.6.6 and install **4.6.7**. CDP stays **1.60.0**, SVM **2.28.0**, Solana Kit **5.5.1**, viem **2.57.13**, wagmi **3.7.9**. No non-Base scheme is registered or used.

Attempting all four official x402 packages at 2.29.0 failed **ERESOLVE**: SVM 2.29.0 requires Solana Kit >=8, conflicting with existing Kit 5.5.1 peer requirements. That candidate was not forced. The three compatible upgrades succeeded without overrides or `--legacy-peer-deps`; actual import, workerd and payment regression tests pass. The lock adds three patched nested Zod copies and one SVM-nested core 2.28.0 entry. This is partial mitigation, not advisory resolution.

Measured CDP import-only probe: baseline **374,327 bytes / 69,168 gzip**, upgraded **1,111,800 bytes / 176,765 gzip** (generated wrapper paths can slightly change bytes). Duplication increases the isolated helper bundle by about 737 kB raw / 108 kB gzip. No x402/CDP package enters the deployable Functions graph. Production bundle input metadata also contains no Zod inputs; this is bundle evidence, not a claim that every installed vulnerable dependency is safe or that public wallet parsing has been independently audited.

Fresh `npm audit`: **exit 1, 17 affected package entries: 5 high, 12 moderate**, down from initial **19 / 7 high / 12 moderate**. `npm audit --omit=dev` also exits 1: **5 high**. These are affected dependency entries, not 17 independent advisories. The two underlying advisories and every current affected entry are listed below.

| Affected installed entry                    | Severity | Chain / exposure / compatible remediation assessment                                                                                                                                                   |
| ------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| zod 3.25.76                                 | High     | CDP, abitype, SVM nested core and optional/tool consumers retain affected <4.6.6 collection validation. Patched Zod is 4.6.6+; do not force its incompatible major over existing peers.                |
| @coinbase/cdp-sdk 1.60.0                    | High     | Direct Zod ^3.25.76 and abitype 1.0.6. Current official SDK metadata still needs an upstream compatible fix; live integration disabled.                                                                |
| abitype 1.0.6                               | High     | CDP's exact dependency leads to Zod 3. No unsupported override. Other viem/ox abitype versions also dedupe optional Zod 3; no public Zod parser use was found in the Functions input graph.            |
| @x402/core 2.28.0 (SVM nested)              | High     | Retained via SVM; root core 2.29.0 uses patched Zod 4.6.7.                                                                                                                                             |
| @x402/svm 2.28.0                            | High     | Optional CDP entry-point peer; 2.29.0 fix conflicts with current Kit peers. Installed solely for bundling; no Solana runtime functionality enabled.                                                    |
| minimatch 10.2.6                            | Moderate | ESLint/config-array/typescript-estree pattern matching; affected <11.0.1. Glob-parts amplification exposure is build/lint tooling, not deployed reporting SQL. Current parents still request major 10. |
| eslint 10.13.0                              | Moderate | Direct minimatch plus config-array/eslint-utils propagation; current 10.14.0 manifest still requests minimatch ^10.2.6.                                                                                |
| @eslint/config-array 0.23.5                 | Moderate | ESLint → minimatch ^10.2.4; no compatible fixed parent identified.                                                                                                                                     |
| @eslint-community/eslint-utils 4.10.1       | Moderate | ESLint peer propagation through typescript-eslint.                                                                                                                                                     |
| @eslint/js 10.0.1                           | Moderate | ESLint peer propagation; no major tooling downgrade applied.                                                                                                                                           |
| @typescript-eslint/typescript-estree 8.72.1 | Moderate | typescript-eslint → minimatch 10.2.6.                                                                                                                                                                  |
| @typescript-eslint/parser 8.72.1            | Moderate | typescript-estree/ESLint propagation.                                                                                                                                                                  |
| @typescript-eslint/type-utils 8.72.1        | Moderate | typescript-estree/utils propagation.                                                                                                                                                                   |
| @typescript-eslint/utils 8.72.1             | Moderate | estree/eslint-utils/ESLint propagation.                                                                                                                                                                |
| @typescript-eslint/eslint-plugin 8.72.1     | Moderate | parser/type-utils/utils/ESLint propagation.                                                                                                                                                            |
| typescript-eslint 8.72.1                    | Moderate | Direct tooling aggregator; latest inspected metadata still uses affected graph.                                                                                                                        |
| eslint-plugin-react-refresh 0.5.7           | Moderate | ESLint peer propagation; audit has no suggested fix.                                                                                                                                                   |

`npm audit` suggests some downgrades or the incompatible SVM/Kit update; those were not automatically accepted. Owner/upstream review is required. Existing parsing limits reduce resource exposure but do not fix the Zod advisory. No suppression, force fix or dependency override was introduced. Tooling findings remain relevant when linting untrusted contributions, even though these dependencies are absent from the deployed API graph.

Primary sources consulted: [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249), official npm manifests at [core 2.29.0](https://registry.npmjs.org/@x402/core/2.29.0), [EVM 2.29.0](https://registry.npmjs.org/@x402/evm/2.29.0), [extensions 2.29.0](https://registry.npmjs.org/@x402/extensions/2.29.0), [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0), [CDP 1.60.0](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0), [ESLint](https://registry.npmjs.org/eslint/latest), [typescript-eslint](https://registry.npmjs.org/typescript-eslint/latest); [CDP x402 overview](https://docs.cdp.coinbase.com/x402/welcome), [Cloudflare Pages headers](https://developers.cloudflare.com/pages/configuration/headers/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/), [Foundry toolchain action](https://github.com/foundry-rs/foundry-toolchain). SDK signatures were also checked directly in installed package declarations. Metadata was read, not used to infer live payment behavior.

## CI

The existing quality job retains locked `npm ci`, formatting, build, lint, Chromium, complete tests and Functions build. `npm test` now includes SG-06. Checkout/setup-node actions are pinned to inspected official commit SHAs, checkout credentials are not persisted, and workflow permissions remain `contents: read`. A Foundry 1.5.1 job runs format/build/tests/gas with the existing pinned Solidity 0.8.28 config. Only that fresh-runner job enables compiler downloading through Foundry; it performs no chain action. The separate full audit job remains mandatory and **will fail with the current findings**. No continue-on-error or deployment job was added. Remote GitHub execution is unverified because nothing was committed or pushed.

## Local QA evidence

Commands were run in the project root, Foundry commands in `contracts/`. Test harnesses allocate their own free loopback ports and temporary D1 state; no unrelated processes were terminated.

| Command                            | Actual final result                                                                                                                                  |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                    | PASS; TypeScript/Vite. Existing ox `node:worker_threads` browser externalization warning remains; no browser errors in tested flows.                 |
| `npm run lint`                     | PASS                                                                                                                                                 |
| `npm run format:check`             | PASS                                                                                                                                                 |
| `npm run test:foundation`          | PASS — 17 groups, real local D1 read/write/cleanup and health/frontend checks                                                                        |
| `npm run test:compatibility`       | PASS — 14 groups, actual CDP helper guard loads in workerd; production health HTTP 200                                                               |
| `npm run test:sg03`                | PASS — 14 groups, SIWE, session/CSRF, ownership and browser CRUD                                                                                     |
| `npm run test:sg05`                | PASS — 88 groups; zero duplicate settlement initiations; local simulation only                                                                       |
| `npm run test:sg06`                | PASS — 20 groups, actual D1/API/Chromium and production bundle isolation                                                                             |
| `npm test`                         | PASS — 153 groups (17 + 14 + 14 + 88 + 20), exit 0                                                                                                   |
| `npm run build:functions`          | PASS — native Pages bundler                                                                                                                          |
| `npm audit`                        | FAIL exit 1 — 17 entries (5 high, 12 moderate), explicitly unresolved                                                                                |
| Local migration helper twice       | PASS — all 3 applied, then unchanged checksums/idempotence                                                                                           |
| `forge --version`                  | 1.5.1-stable, b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2                                                                                               |
| `forge fmt --check`, `forge build` | PASS; existing lint notes/test-only bounded-cast warnings remain                                                                                     |
| `forge test -vvv`                  | PASS — 47 tests, 0 failed/skipped; 3 suites including 4 invariant properties, 512-run fuzz, 128×64 invariant campaigns                               |
| `forge test --gas-report`          | PASS — 47 tests; deployment 955,984 local gas units, 4,239 bytes; registration mean 69,408, update 40,874, disable 26,565. Not Base cost quotations. |

The 20 SG-06 groups cover actual empty D1 results; 8 deterministic test attempts/2 consistent local receipts plus one unverified legacy receipt; exact 1,000,000,000,000 atomic simulated total; duplicate receipt constraint; cross-merchant access; tied-timestamp pagination/cursor scope; secret/provenance redaction; filter/date limits; methods/header/body/origin/cache/CORS; real missing-table failure and restoration; expired/logout sessions; fixture egress rejection; injected-provider wrong chain and real local SIWE; honest dashboard metrics; backend filtering; loading and error/retry; 390px/1280px layouts, labels/buttons/keyboard; logout/session-switch cache isolation; and production route/bundle isolation. Seed records exist only inside temporary local test D1, never ordinary development/application data.

Browser provider behavior is simulated; signatures/server verification, HTTP, SQL and rendering are real local execution. Browser network interception is test-only. No uncaught browser errors or external browser requests occurred in those scenarios. Screenshots and runner logs are ignored local evidence under `.wrangler/sg06-*`; they are not application fixtures or published proof. Accessibility checks are focused control/keyboard/layout checks, not a complete WCAG audit. No real wallet, screen reader, production load, TLS deployment or remote CI was tested.

Production bundle metadata explicitly excludes `tests/`, `server/sg05/`, `@x402` and `@coinbase`. Actual requests to test/payment path candidates with forged opt-in flags do not authorize content or produce PAYMENT-RESPONSE. Only the authenticated reporting router was added to production. No public payment parser, settlement, registry mock or proxy is reachable.

### Failures encountered and corrected

An early local migration failed because the existing SQL splitter treated a comment semicolon as a boundary; explicit statement markers fixed the new migration. TypeScript D1 row typing and an ESLint effect-state warning were corrected. Browser assertions initially used an ambiguous implicit select label and inspected receipt results before that independent query completed; the select now has an explicit accessible name and the assertion waits for the record. Generated temporary Wrangler handlers were picked up by concurrent lint; ESLint now narrowly excludes generated `.wrangler/` and contract output/cache directories. One explicit Prettier invocation on SQL reported no parser; SQL is not a supported formatter input and the normal repository formatting check passes without installing a formatter plugin. The SG-05 late-body failure and stronger elapsed-time guard are described above. None of those initial failures was counted as a passing run.

## Changed file inventory

Created:

- `server/sg06/reporting.ts`, `shared/reporting.ts`, `src/sg06/Activity.tsx` — authenticated read models, DTOs and dashboard.
- `migrations/0003_sg06_reporting_indexes.sql` — forward indexes only.
- `public/_headers` — static security policy.
- `tests/sg06/handler.ts`, `tests/sg06/run.mjs`, `tests/sg06/tsconfig.json` — isolated D1/API/browser QA.
- `docs/API_QUICKSTART.md`, `docs/ONBOARDING.md`, `docs/RELEASE_CHECKLIST.md`, `docs/SG-06_REPORT.md` — actual API/user guidance and blocked release packet.

Modified:

- `src/sg03/Workspace.tsx` — integrate reporting and cancel/reset session-dependent caches.
- `server/sg03/api.ts`, `server/sg03/http.ts` — authenticated read routing, request bounds and JSON security headers.
- `server/sg05/upstream.ts`, `server/sg05/gateway.ts` — required trusted-clock deadline check before local protected response release.
- `scripts/local-runtime.mjs` — optional validated fixture prefix, existing SG-05 default preserved.
- `tests/sg03/run.mjs`, `tests/sg05/run.mjs` — new migration name expectations only.
- `package.json`, `package-lock.json` — SG-06 command/aggregate tests and three compatible SDK updates.
- `eslint.config.js` — exclude generated local runtime/Foundry output from source lint.
- `.github/workflows/ci.yml` — least-privilege pinned actions, aggregate coverage and Foundry job.
- `README.md`, `docs/ENVIRONMENT.md` — current capabilities, honest phase/release status and configuration.

No contracts, production health handler, historical report, old migration, canonical checklist or review archive was modified.

Final read-only `git diff --check` passed. `git status --short` shows only the files inventoried above and the four preserved untracked review archives; HEAD remains `df30342`. No Git metadata was changed. The aggregate rerun exited 0; its SG-05 simulation reported zero duplicate settlement initiations. Audit exits 1 remain intentional unresolved failures, not a passing security gate.

## Remaining blockers and owner decisions

Public payment release remains **BLOCKED** by vulnerable dependencies, no approved onchain registry observation/admission, no authenticated live facilitator evidence, no production reconciliation/clock/connection-safe upstream transport, unreviewed immutable compiler/security assumptions and missing production operational controls. The [release checklist](RELEASE_CHECKLIST.md) is a non-executing SG-07 approval packet covering owner-approved compiler/deployment/verification, exact gas estimation, official Base USDC, wallet/budget permissions, real binding and credentials provisioning, registry synchronization, retries/refunds, DNS/SSRF, quotas/costs, Hostinger custom-domain change review and separately approved Mainnet smoke-test evidence. No addresses, hashes, fee quotations or credential values are invented.

Owner/ChatGPT should review the source, SDK peer compromise/bundle growth, provenance fail-closed policy, audit findings, clock hardening and remaining release gates before deciding phase acceptance. No approval for incompatible Solana/tooling upgrades, risk acceptance, deployment, credentials, DNS or spending is inferred. SG-06 remains IN PROGRESS. No SG-07 work was executed.
