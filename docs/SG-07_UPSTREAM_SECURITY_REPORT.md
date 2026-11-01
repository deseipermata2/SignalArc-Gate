# SG-07 — Upstream security and SSRF release gate

**SG-07 remains IN PROGRESS. Local controls pass their stated tests; production upstream access, public paid fulfillment and Mainnet launch remain BLOCKED.** No URL/DNS policy test is represented as proof of a constrained live connection.

## Baseline and findings

Inspection confirmed `/home/deseti213/projects/signalarc-gate`, branch `main`, HEAD **4376156**, matching the owner. Only eight review archives were initially untracked; all were preserved. No applicable AGENTS.md or canonical V2 rules/roadmap files were found locally or in applicable ancestors. The supplied constraints govern. Existing registry admission/quarantine, five migrations and completed phase reports remain intact.

Reviewed native Functions routing, SG-03 URL/ownership validators, SG-05 bounds/gateway/receipt lifecycle, SG-07 denial policy and the workerd/D1 harnesses. The production tree has only health and authenticated auth/resource/reporting APIs; it imports no payment gateway or upstream fixture. Production transport already rejected every URL, so this task did not uncover or enable a live proxy.

Two local gaps were addressed: URL parsing accepted some ambiguous authority spellings through normalization, and the isolated gateway lacked an explicit transport-eligibility check before a payable challenge/settlement. Its delivery timeout also left the final clock read outside the timer race. These are readiness hardening changes, not evidence of live exploitation or a completed SSRF solution.

## Threat model and actual boundary

| Threat                                                            | Implemented control / remaining boundary                                                                                                                                                                                                                                              |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Local/private/link-local/metadata/reserved/multicast destinations | Reject all IP literals, including public IPs, and special-use hostname suffixes. This is a conservative lexical rule; valid public DNS names can still resolve to unsafe addresses.                                                                                                   |
| IPv4 alternate forms / mapped IPv6                                | WHATWG parsing plus hostname-only validation rejects dword, hexadecimal, octal/short IPv4 and bracketed IPv6. Encoded authorities are rejected before normalization.                                                                                                                  |
| Userinfo, ports and parser ambiguity                              | HTTPS only; ASCII hostname authority with absent port or literal `:443`; reject raw userinfo, empty/zero-padded/unsupported ports, backslashes, whitespace/controls, fragments and malformed labels.                                                                                  |
| Unicode / hostname confusion                                      | Raw Unicode or percent-encoded authority is rejected. Explicit ASCII A-label hostnames can pass syntax validation; this does not certify who controls the domain. Canonical hostname/default port normalization remains deterministic.                                                |
| DNS rebinding / CNAME changes                                     | No resolver or peer pin is implemented. A prior public DNS answer is not a connection authorization. Production denial is retained even for URL-policy-approved names.                                                                                                                |
| Redirects / same-account/internal services                        | Fresh requests use manual redirect handling; non-200 and already-redirected responses are rejected. No arbitrary service binding, internal alias or provider host is approved. No live first connection is permitted.                                                                 |
| Cross-merchant configuration                                      | Existing session-owned CRUD/registry checks remain. The local manifest separately matches resource ID, merchant ID and exact canonical URL; it is not derived from merchant URL input.                                                                                                |
| Buyer/merchant credentials                                        | Construct a fresh bodyless GET with only application header `Accept: application/json`. No incoming headers, cookies, payment authorizations, sessions or server secrets are copied. URL queries are excluded by the local demonstrator. No upstream credential vault is implemented. |
| Large/slow responses / JSON complexity                            | Header, declared/streamed byte and JSON structural limits; one delivery deadline covering eligibility, clock reads, headers/body and parsing, plus elapsed-time/rollback checks. No assumption that cooperative cancellation is a hard production CPU/network kill.                   |
| Cache/content leakage                                             | Set outbound `cache: no-store`; never copy upstream cache/cookie headers; retain private/no-store paid responses. No app Cache API or protected-response reuse is introduced. Actual edge/cache deployment behavior is unverified.                                                    |
| Resource exhaustion                                               | Bounded inputs reduce per-request exposure, but no global production limiter, concurrency/retention/load budget or capacity proof is added. Free-tier quotas are not security controls.                                                                                               |

A private upstream URL must be sent to its selected upstream to make a request; this design does not claim otherwise. It is omitted from buyer errors, reporting and logs. A path can itself contain a secret, so operator approval must exclude secret-bearing URLs; syntactic validation cannot reliably discover arbitrary embedded credentials. The new code neither reads nor forwards environment credentials.

## Official Cloudflare investigation

Five layers must remain distinct: (1) lexical URL normalization, (2) optional independent DNS inspection, (3) the address actually selected by runtime fetch, (4) enforceable restrictions on that connection and (5) any redirected connection. Only the first is implemented for merchant registration; successful policy matching does not establish layers 3–4.

Cloudflare's [Request documentation](https://developers.cloudflare.com/workers/runtime-apis/request/) describes manual redirects and a hostname-based, same-zone `resolveOverride`. Those do not provide this application with an approved-IP pin for arbitrary merchant hosts. It also warns that following redirects can forward sensitive headers. The gateway uses a fresh request and manual rejection instead. No independent DNS lookup was added or conflated with connection safety.

[Fetch documentation](https://developers.cloudflare.com/workers/runtime-apis/fetch/) documents `cache: no-store` and automatic compression behavior. The implementation explicitly requests no-store, validates returned encoding/type and copies no upstream cache headers. That is not proof of every Cloudflare-hosted origin's cache behavior or of pre-userland decompression resource limits. No actual origin was contacted.

[HTTP service bindings](https://developers.cloudflare.com/workers/runtime-apis/bindings/service-bindings/http/) and [Pages bindings](https://developers.cloudflare.com/pages/functions/bindings/#service-bindings) provide a named server capability to a selected Worker. That is a candidate for fixed reviewed handlers, not permission to forward merchant-selected URLs through another proxy. No service/binding/Worker was created or configured.

The separate [TCP socket API](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) exposes nullable peer information after connection and documents destination restrictions. This is not the existing Fetch transport, nor a reviewed HTTPS/TLS/HTTP parser replacement. Its restrictions cannot simply be assumed to apply as this application's complete Fetch SSRF policy. No socket experiment, external connection or alternate backend was introduced.

[Performance/timer documentation](https://developers.cloudflare.com/workers/runtime-apis/performance/) explains that deployed timer readings advance with I/O and can differ from local behavior. The new timer race includes the final clock read and rejects late/negative elapsed time, but a reliable production clock/cancellation/CPU policy still needs independent evidence. Local tests do not establish preemption of arbitrary synchronous work.

Conclusion: connection-destination enforcement for arbitrary HTTPS URLs remains **UNPROVEN** in the approved implementation. No statement that all possible Cloudflare designs are impossible is intended. The unresolved property is enough to keep the real production path denied.

## Options evaluated

| Option                                                  | Technical assessment                                                                                                                                 | Scope / decision                                                                                                                               |
| ------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| Arbitrary merchant HTTPS URLs via ordinary global fetch | Parser checks and a DNS precheck do not pin the connection; redirects add another destination                                                        | Approved eventual product model, but unsafe/unproven to enable now; keep disabled                                                              |
| Explicit hostname/origin allowlist                      | Reduces selectable names but not DNS/CNAME or same-host route risks; an origin alone does not approve every path                                     | Governance/scope reduction requires owner approval; not a complete SSRF fix                                                                    |
| Fixed operator-verified HTTPS URLs                      | Stronger exact target policy and controlled DNS administration, but live connection/TLS/cache/alias assumptions still require proof                  | Candidate reduced mode only after explicit scope/security approval; no actual origin supplied                                                  |
| Fixed named Cloudflare service binding                  | Can route to a specifically bound reviewed handler without using a merchant URL to select the service; downstream must not become an arbitrary proxy | Smallest candidate for owner review within the stack, but narrows supported upstreams and requires separate implementation/deployment approval |
| Custom low-level socket HTTP client                     | Different transport/TLS/HTTP/security surface; no implementation or proof in this task                                                               | Not silently adopted; substantial review/owner approval needed                                                                                 |
| Continued production denial                             | Prevents this application from initiating any upstream connection/payment fulfillment                                                                | **Selected current policy**; preserves agreed product scope without pretending it is released                                                  |

Recommendation: retain denial. If the owner wants a constrained first production surface, review **fixed named service bindings to owner-reviewed JSON handlers with no merchant-controlled downstream fetch**, plus a versioned resource/merchant policy. This is a proposal, not an approved scope change or deployment plan execution. An ordinary allowlist wrapped around unrestricted fetch is not the proposed security guarantee. If arbitrary third-party HTTPS remains mandatory, its connection-safe transport must be separately proven before charging anyone.

## Implemented local controls

### URL and eligibility policy

`httpsUpstream` retains the existing hostname-only registration model and adds raw ASCII-authority validation. Raw Unicode/encoded hosts and empty/zero-padded ports are refused; canonical ASCII A-labels and literal 443 remain supported. Existing persisted canonical URLs/commitments are not rewritten. The validator performs no DNS/fetch and does not claim that accepted names are safe to connect to.

`UpstreamAccess` now requires both an eligibility method and an injected request transport. `createLocalUpstreamAccess` is explicitly a **local policy demonstrator**, with no default fetch or production enable flag. Its resolver returns a separately configured resource/merchant/exact-URL entry, rejects missing/mismatched entries and queries, and never proves a peer address. The SG-05 fixture seeds that manifest in a **test-only local table** with a fixed example URL; merchant CRUD does not populate it. No application migration or production allowlist database was added.

The gateway checks eligibility before SDK discovery/challenge creation, before verification/settlement through its existing snapshot rechecks, at delivery and before final release. Known policy denial cannot create a new charge. Checks do not contact upstreams to predict availability. The demonstrator rereads its manifest, but it is not a durable production policy-version/ABA protocol; future operator policy versions must be tied to approved snapshots/CAS. No claim of distributed atomicity across policy, chain, D1 and external services is made.

### Response and deadline policy

The JSON reader now:

- Uses GET with no body and a newly constructed single application header; redirect mode manual and cache mode no-store. No browser cookie-jar assumptions or unsupported browser-only RequestInit flags are used.
- Accepts only status 200, not redirects/partial responses or an already-followed redirect.
- Bounds response headers to 16,384 UTF-8 bytes, checks Content-Length syntax and refuses a declared oversize body before parsing. Rejected status/header responses are cancelled without waiting indefinitely on cancellation.
- Requires `application/json` with optional UTF-8 charset, and identity/no declared content encoding. Unsupported charset/compression is rejected; actual runtime compression costs before userland bounds remain unverified.
- Retains streamed byte caps from resource configuration (1024–1048576), eight-level JSON depth, 64 entries per collection, 1024 total nodes, bounded keys/strings and fatal UTF-8 decoding. Body limits apply to bytes the stream exposes; they do not certify network/TLS/decompression CPU costs.
- Applies one 1000ms delivery timer across both clock reads, eligibility, response headers, streaming and parsing; there is no fresh budget after headers. Rejects negative or >=1000ms elapsed readings before release. Input byte/structure limits bound parsing work; a JS timer is not a preemptive CPU interrupt.

The final resource/registry revision CAS remains in place. Outbound/header construction does not accept an incoming Request. Upstream cookies/cache/private headers are not copied to responses; existing private/no-store payment headers remain. `productionUpstream` still validates then throws `connection_safe_transport_unavailable` for every URL.

## Payment and fulfillment behavior

No settlement state transition was changed. Known-ineligible resources are blocked before a payable challenge, facilitator discovery, verification or settlement. A policy revoked after a challenge or during verification is rechecked before a settlement claim. Resource revision/ownership/registry changes remain subject to existing hash/generation/CAS checks; registration/update does not automatically fetch anything.

Delivery starts only after the existing receipt has been persisted from successful **local simulated** settlement. Post-settlement delivery/policy failure keeps the receipt, coarse `status=settled` and `phase=fulfillment_failed`; retries do not settle again or release content. The server release claim is not proof that a buyer received bytes. A revocation after an external settlement was already initiated cannot retroactively undo it. No refund, paid recovery endpoint or second payment is invented.

Production payments and actual authoritative Mainnet evidence admission remain disabled. All positive settlement evidence in these tests is LOCAL SIMULATION ONLY, not Mainnet volume or live CDP compatibility certification.

## Tests and actual evidence

`npm run test:upstream-security` passes **32 native workerd/D1 groups**, with parameterized URL cases inside groups. It covers:

- Localhost/private/reserved/link-local/metadata IPv4, mapped/private/link-local/multicast IPv6, short/octal/hex/dword/encoded IPs, schemes, credentials, ports, malformed/Unicode authorities and canonical ASCII normalization.
- Missing/resource/merchant/URL policy mismatches and query exclusion before transport, with request count zero.
- A DNS-rebinding model and a CNAME-to-metadata model: URL policy matches, production transport denies, actual transport count remains zero. These are **POLICY DENIAL TESTS ONLY**, not live DNS or socket tests.
- A safe constructed local GET, browser-supplied fake auth/cookie/payment headers not forwarded, and private/no-store fixture responses.
- Redirect-to-metadata/partial status, no-header-response timeout, slow body cancellation, late headers/body, final clock hang, clock rollback, stream/declared oversize, large/malformed headers, content type/charset/encoding, malformed UTF-8/JSON, excessive nesting/collection size. No failing case returns protected JSON or initiates a redirect/retry.
- Global test-isolate egress rejection; actual production Functions metadata exclusion; forged transport flags/bodies cannot open paid/proxy routes.

The 32 groups use in-process mock Response/stream objects within real local workerd. The D1 binding is native and its five migrations apply/repeat; this does not constitute a public-origin connection test. The fixture requires explicit local opt-in, exact loopback Origin/request method, local mode and Miniflare metadata. No global fetch wrapper or test transport is introduced into production application code.

SG-05 now passes **95 HTTP/D1 groups** (previous 90 retained, five added): known denial yields zero new attempt/discovery/verify/settle/upstream requests; revocation before verification and during verification yields no charge or receipt; persisted receipt/fulfilling state exists before the positive upstream request; buyer header isolation/upstream cookie/cache stripping is checked at the loopback mock; post-settlement policy failure retains one receipt/settled status and rejects retry without another settlement. Existing configuration-change, unsafe URL, delivery failure, ambiguity, concurrency and runtime-restart tests remain intact.

### Verification commands

| Command                                               | Actual result                                                                              |
| ----------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| `npm run build`                                       | PASS — TypeScript/Vite; existing ox worker_threads externalization warning remains         |
| `npm run lint`                                        | PASS                                                                                       |
| `npm run format:check`                                | PASS after report formatting                                                               |
| `npm run test:foundation`                             | PASS through aggregate — 17 checks, health/D1/browser preserved                            |
| `npm run test:compatibility`                          | PASS through aggregate — 14 checks, actual helper/workerd guard and health 200             |
| `npm run test:sg03`                                   | PASS through aggregate — 14 checks, auth/CRUD/ownership/browser preserved                  |
| `npm run test:sg05`                                   | PASS — 95 checks, zero duplicate settlement initiations                                    |
| `npm run test:sg06`                                   | PASS through aggregate — 20 checks                                                         |
| `npm run test:sg07`                                   | PASS through aggregate — 45 checks                                                         |
| `npm run test:registry-admission`                     | PASS through aggregate — 43 checks, durable quarantine retained                            |
| `npm run test:upstream-security`                      | PASS — 32 checks                                                                           |
| `npm test`                                            | PASS — 280 groups (17 + 14 + 14 + 95 + 20 + 45 + 43 + 32)                                  |
| `npm run build:functions`                             | PASS — native Pages bundle                                                                 |
| `npm audit`                                           | FAIL exit 1 — 17 affected entries: 5 high, 12 moderate                                     |
| `npm audit --omit=dev`                                | FAIL exit 1 — 5 high affected entries                                                      |
| `forge fmt --check`, `forge build`, `forge test -vvv` | PASS — 47 tests, zero failed/skipped; existing notes/test-cast warnings retained           |
| `git diff --check`, read-only Git status              | No whitespace errors; changes limited to inventory below, HEAD remains 4376156             |
| Migration checksum/repeat checks                      | All five historical digests unchanged; native helper repeats them without applying new SQL |

One initial build/SG-05 invocation failed because browser-only `credentials` was not a Workers RequestInit property. Those unsupported browser options were removed rather than type-cast through; fresh-header isolation is asserted directly. That failed invocation is not counted as a PASS. No advisory, test or security gate was suppressed. Logs/metafiles are ignored under `.wrangler/`; CI configuration is unchanged but its aggregate `npm test` now includes the new suite. Remote CI is unverified because no commit/push occurred.

## Exact file inventory

Created:

- `tests/upstream-security/handler.ts`
- `tests/upstream-security/run.mjs`
- `tests/upstream-security/tsconfig.json`
- `docs/SG-07_UPSTREAM_SECURITY_REPORT.md`

Modified:

- `shared/resources.ts` — reject ambiguous raw URL authorities, preserving canonical hostname-only validation.
- `server/sg05/upstream.ts` — eligibility capability, bounded request/response and full delivery deadline.
- `server/sg05/gateway.ts` — eligibility checks before challenge/verification/settlement and release, no new settlement semantics.
- `server/sg07/upstream.ts` — local exact-resource/merchant/URL policy demonstrator; production denial retained.
- `tests/sg05/handler.ts` — isolated server-owned test manifest and revocation control.
- `tests/sg05/run.mjs` — five HTTP/D1 flow assertions and cache-header mock scenario.
- `package.json` — dedicated command and aggregate inclusion.
- `docs/SG-07_READINESS_REPORT.md`, `docs/RELEASE_CHECKLIST.md`, `docs/SG-07_LAUNCH_RUNBOOK.md` — current gate evidence and approval requirements.

No dependency/lockfile, contract/ABI/compiler setting, migration, production Function, Wrangler/service configuration, authentication/session/ownership model or review archive was changed. No production allowlist or DNS entries were supplied. No provider/framework/hosting switch was made.

## Remaining release blockers and owner decisions

**Public upstream access and paid fulfillment remain disabled.** This task proves local validation, eligibility and denial behavior, not a safe arbitrary Internet connection or Mainnet settlement. The owner must review a specific transport strategy and explicitly approve any reduction from arbitrary merchant HTTPS resources to fixed operator-controlled services. Service identity, handler behavior/no-proxy constraints, versioned policy/CAS, DNS/TLS/cache/clock/load behavior and real capacity/security evidence must pass before any enabling change. No approval is inferred here.

Audits remain unresolved (Zod/CDP/SVM and minimatch/tooling); bounds are not dependency remediation. Approved deployment/code/provider/finality admission, trusted conflict resolution, authenticated CDP evidence, canonical reconciliation, production clock/operational rate/retention controls, real D1 binding/backups, TLS/domain and paid-but-unfulfilled policy remain separate blockers. All Mainnet, credential, remote migration, publication, spending and Hostinger actions retain their separate non-executing runbook approval boundaries.

Eight review archives were preserved. No transaction signing/broadcast, live upstream/RPC/CDP connection, real payment, remote D1 operation, deployment, secret provisioning, paid service, DNS/Git mutation or unrelated repository modification occurred. Existing regression signatures remain isolated unfunded local test authorizations, not blockchain transactions. **SG-07 remains IN PROGRESS; production/Mainnet release remains BLOCKED. Stop for owner/ChatGPT review.**
