# SG-03 — Wallet, SIWE, D1 Schema and Endpoint CRUD

Official status: **IN PROGRESS, ready for owner/ChatGPT review.** SG-00 through SG-02 are owner-approved complete. No roadmap checkbox was edited and SG-04 was not started. This report describes local implementation and verification, not production deployment/security approval.

## Starting state and preservation

Inspected the repository structure, package manifest/lock, Wrangler/Vite/TypeScript/ESLint configurations, SG-02 report, environment documentation, and existing foundation/compatibility runners. No applicable AGENTS.md, `SIGNALARC_GATE_ROADMAP_V2.md` or `SIGNALARC_GATE_PROJECT_RULES_V2.md` was found locally, so the owner's supplied requirements govern this work.

HEAD remains owner-created `d442df2`. The pre-existing untracked `SG-02-review.tar.gz` was left untouched. Git was used only for status, log, diff and file inspection; no staging, commit, push, fetch, checkout, branch, remote or configuration mutation occurred.

The SG-02 reports, health function, foundation/compatibility test implementations, Wrangler configuration and CI workflow remain unchanged. Root `/` retains the actual health screen, with a link to `/manage` and wrapping header navigation for mobile. Existing scripts remain available; `npm test` now also runs SG-03, so the existing CI quality job includes it without a workflow rewrite.

## Exact files created or modified

Created:

- `functions/api/[[path]].ts`
- `migrations/0001_sg03.sql`
- `scripts/dev-local.mjs`
- `scripts/local-runtime.mjs`
- `scripts/migrate-local.mjs`
- `server/sg03/api.ts`
- `server/sg03/auth.ts`
- `server/sg03/http.ts`
- `server/sg03/resources.ts`
- `shared/resources.ts`
- `src/sg03/Workspace.tsx`
- `src/sg03/wallet.ts`
- `tests/sg03/run.mjs`
- `docs/SG-03_REPORT.md`

Modified:

- `.prettierignore`: preserve the now-historical SG-02 report during formatting.
- `README.md`, `docs/ENVIRONMENT.md`: actual local startup/migration/configuration instructions and boundaries.
- `package.json`, `package-lock.json`: approved dependencies and scripts.
- `src/App.tsx`: lazy-loaded workspace route and navigation; existing health behavior preserved.

Ignored local artifacts include `dist/`, `.wrangler/` bundles/metafiles, temporary test state and desktop/mobile screenshots. No environment/credential file or production database identifier was created.

## Dependencies

| Direct dependency       | Exact version | Change                                                                                                                                          |
| ----------------------- | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `wagmi`                 | 3.7.9         | Added for injected wallet connection, network state, message signing and disconnect                                                             |
| `@tanstack/react-query` | 5.105.0       | Added for real session/resource queries and mutations                                                                                           |
| `viem`                  | 2.57.13       | Promoted the existing transitive version to a pinned direct dependency; SIWE utilities, EOA recovery, address validation and Base configuration |

Lockfile comparison: **8 entries added, 0 removed, 0 existing versions changed**. CDP 1.60.0, all four x402 packages 2.28.0, React/Vite/TypeScript/Wrangler and existing test tooling remain at their prior versions. No forced installs, legacy-peer bypasses, dependency overrides or alternative frameworks/providers were introduced.

## D1 schema and local migrations

`0001_sg03.sql` defines seven application tables without seed data:

| Table              | Purpose and main constraints                                                                                                                        |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| `merchants`        | Server-generated ID; unique lowercase verified wallet; creation/update timestamps                                                                   |
| `auth_nonces`      | Unique nonce hash; browser hash; wallet/origin/canonical message; requester hash; issue/expiry/consumption times; unique winning session claim hash |
| `sessions`         | Session token hash as key; merchant FK; fixed chain 8453; origin; creation/expiry/revocation times                                                  |
| `api_resources`    | Merchant FK; server UUID; URL/JSON settings; canonical USDC atomic string; payout address; fixed network; enabled state; timestamps                 |
| `payment_attempts` | Merchant/resource ownership FKs; unique merchant idempotency key; Base-only amount/status foundation; timestamps                                    |
| `payment_receipts` | Unique attempt FK and transaction hash; Base-only receipt foundation; payer/payout/amount/block/timestamp fields                                    |
| `analytics_events` | Merchant and optional owned-resource FKs; bounded event types and event timestamp                                                                   |

Primary keys are explicitly non-null. Resource JSON uses `json_valid`; atomic resource prices are positive canonical digit strings, at most 12 digits. Composite resource ownership constraints link payment attempts/analytics to their merchant. Indexes support nonce expiry/requester/wallet windows, session expiry/merchant lookup, owner resource listing, attempt lookup and analytics time ranges. Application timestamps are Unix milliseconds. Payment/analytics tables are schema foundations only; no settlement route, fake receipt or fabricated metric was added.

The current Wrangler file intentionally has no `d1_databases` identity. Actual command:

```sh
npx wrangler d1 migrations list SIGNALARC_DB --local
```

Result: **exit 1**, `Couldn't find a D1 DB with the name or binding 'SIGNALARC_DB' in your wrangler.jsonc file.` This was a local-only listing, not a remote operation. A production UUID was not invented to satisfy it.

The safe local implementation is `npm run db:migrate:local`. It creates a temporary native Pages process with only local `--d1 SIGNALARC_DB`, checks D1's `miniflare.db` metadata, applies the SQL in a transactional `D1Database.batch`, and records filename/digest/time in a local-only `local_migrations` ledger. Repeat application verifies the digest and skips existing files. Changed applied SQL fails closed. Current files contain simple statements; the local splitter does not claim support for triggers or semicolons inside SQL literals.

Default persistent state is `.wrangler/state`, shared with normal Pages dev. `--persist-to <local directory>` selects isolated disk state, never a remote DB identifier. The standalone command was verified twice against isolated state: first `0001_sg03.sql` applied, then `already applied (checksums verified)`. A separate root-repository Pages process reused that CLI-migrated state and returned HTTP 200 from the real nonce endpoint, proving it was the same usable local database. That operational test state was removed afterward.

The local helper is not a provisioned production migration service. Production migration/binding setup still requires an owner-supplied real D1 identity and separately authorized operations. No remote database or migration was created/applied.

## Authentication and sessions

### Injected wallet connection

The actual application uses wagmi's injected EVM connector and viem Base configuration, with `chains: [base]` only. Connection/address/network/disconnect state comes from provider APIs. Base switching occurs only on an explicit user click. Sign-in is disabled on an incorrect network, and wallet/account state is rechecked before signing and before submitting the signature. Signing explicitly supplies the selected account, as required by installed wagmi v3.

The public RPC transport fails closed: SG-03 needs only injected account/network/personal-sign APIs, not chain reads or transactions. No send-transaction hook, wallet key input, seed phrase input, paid RPC credential or WalletConnect project is used. Contract-signature authentication is explicitly unsupported; only standard EOA personal-sign signatures are accepted.

### SIWE challenge and verification

`POST /api/auth/nonce` creates a fresh cryptographic 256-bit hex nonce, a separate 256-bit browser challenge cookie, and a server-created EIP-4361 message. D1 stores hashes, the canonical message, requested wallet, exact configured origin, issuance and five-minute expiry. Nonce creation is bounded to 32 live challenges per wallet and 200 per requester IP/origin over five minutes. Expired nonce/session records are pruned opportunistically when another challenge is issued.

The signed message explicitly states that sign-in authorizes no transaction or payment. Verification uses viem SIWE parsing/validation, required fields, fixed chain 8453, expected domain/URI/statement, server time/expiry checks and exact equality with the stored server-generated message. A matching HttpOnly browser challenge cookie is mandatory. EOA recovery must cryptographically match the requested SIWE address. Invalid signatures, malformed/altered messages, expired messages/nonces, wrong origin/domain/chain, unsupported contract signatures and cookie mismatch fail without granting a session.

Nonce consumption, merchant association, session insertion and previous-browser-session revocation share **one D1 transaction**. A conditional nonce UPDATE attaches the new random session hash only if the nonce is unused and unexpired. All dependent INSERTs require that exact claim hash. Two concurrent verifiers can therefore create only one session; a loser cannot create a merchant/session or revoke the winner's session. The real local test submits concurrent identical signed requests and observes one 200, one 401, one new session and one merchant. Replay with the original challenge cookie also fails.

### Server sessions and CSRF

Session tokens are independently random 256-bit values; only SHA-256 hashes are stored in D1. They expire after eight hours and are looked up with exact origin, chain, merchant FK, expiry and revocation checks. Re-authentication rotates the token and revokes the prior browser token. Logout invalidates the current token server-side and clears cookies. Already invalid logout is idempotent.

HTTPS uses `__Host-sg_session`/`__Host-sg_challenge`, Secure, HttpOnly, SameSite=Strict and Path=/, without Domain. Only explicit `APP_ENV=local` plus a loopback `APP_ORIGIN` allows non-Secure local HTTP cookie names. The response JSON never contains a session token; browser storage contains no authentication token. Actual Chromium tests confirm the cookies are inaccessible through `document.cookie` and no token is placed in localStorage.

Session-status GET is non-mutating: invalid/expired sessions return `authenticated: false`, and protected operations return 401. It does not clear cookies, avoiding a delayed unauthenticated status response erasing a freshly issued login cookie. Logout explicitly clears cookies. Browser disconnect is disabled while sign-in is pending; normal app disconnect first invalidates the server session.

Every POST/PATCH/DELETE requires the exact configured Origin, `X-SignalArc-Request: 1`, and application/json. Cross-site Fetch Metadata is rejected, and no CORS grant is provided. This custom-header/origin policy plus Strict cookies protects mutations without exposing a session secret to JavaScript. The request URL must match server `APP_ORIGIN`; forwarded host/origin headers are not used to construct the SIWE scope.

## Implemented native API routes

| Method | Route                 | Actual behavior                                                                      |
| ------ | --------------------- | ------------------------------------------------------------------------------------ |
| GET    | `/api/health`         | Unchanged SG-02 response and no-store header                                         |
| POST   | `/api/auth/nonce`     | Validate EOA address and chain, persist browser-bound challenge, set HttpOnly cookie |
| POST   | `/api/auth/verify`    | Verify SIWE/EOA signature, atomically consume nonce and create/rotate session        |
| GET    | `/api/auth/session`   | Current server-verified merchant/expiry or unauthenticated status; no token returned |
| POST   | `/api/auth/logout`    | Revoke token and clear cookies                                                       |
| GET    | `/api/resources`      | List only the signed-in merchant's resources                                         |
| POST   | `/api/resources`      | Validate and persist an owned resource; 201 response                                 |
| GET    | `/api/resources/{id}` | Read an owned resource; other merchants receive 404                                  |
| PATCH  | `/api/resources/{id}` | Update supported owned configuration fields                                          |
| DELETE | `/api/resources/{id}` | Persist soft-disable (`enabled = 0`), not hard deletion                              |

Other API paths return 404; unsupported methods return 405. Missing server configuration/schema fails closed with clear 503 errors. Authentication and resource responses are no-store. No public migration, expiry-control, raw SQL, proxy, x402 parsing or settlement route is implemented.

## Ownership, validation and SSRF boundaries

Only the verified session identifies a merchant. Client-supplied merchant IDs, resource IDs in create bodies, or wallet fields outside the supported schema are rejected; they never act as proof of ownership. Every resource lookup/update/disable constrains merchant ID in prepared SQL. Payout address is configuration, not ownership: the two-wallet test changes Alice's payout to Bob's valid address and verifies Bob still cannot read or modify Alice's resource.

Names, nonzero Ethereum addresses/checksums, exact Base identifiers, JSON types/allowed keys, canonical prices, status and response configuration are validated strictly. Resource amounts are strings of positive atomic USDC units, 1–999999999999. UI decimal conversion uses BigInt and six decimals. The browser rejects a seven-decimal price, and entering 0.000001 USDC persists exactly string `1` in D1. A merchant has a hard atomic creation cap of 100 resources; its bounded list is complete.

Response settings support JSON, a 1024–1048576 byte limit and redirects policy `error` only. All applicable SQL values use bound parameters. JSON bodies are streamed with a 16 KiB cap and eight-level nesting limit before parsing; SIWE messages are at most 4096 characters and URLs at most 2048. Errors do not echo supplied signatures, cookies, credential-bearing URLs, configuration values or database-bound values.

Registration rejects unsafe schemes, URL authority credentials (including empty userinfo), non-443 ports, fragments, controls/whitespace/backslashes, malformed/overlong hostnames, every IP literal (including public IPs), and localhost/private special-use names. Numeric/hexadecimal IPv4 aliases and IPv6 literals are rejected after URL normalization. The gateway cannot register itself as upstream.

**No upstream fetch occurs at registration, edit or any other SG-03 operation.** The metadata validator does not resolve DNS and cannot establish whether an otherwise valid public hostname/CNAME resolves to private IPs or rebinds. Redirect targets/responses are not fetched or validated. Execution remains disabled until a later reviewed implementation can enforce DNS/redirect safety. `enabled` currently means enabled configuration, not a working public paid-content route. The test worker and browser also block non-local outbound fetch; no upstream, facilitator or blockchain RPC call is made.

## Frontend behavior

`/manage` is a lazy-loaded workspace using the existing shadcn Button/Card and Tailwind v4 foundation. It provides connection/disconnection, wrong-network indication and explicit Base switch, SIWE consent/loading/errors, actual server authentication status, logout, a real owned resource list/empty state, create/edit forms, persisted status and disable controls.

Forms expose real URL, USDC price, payout, JSON response size and enabled settings with accessible labels. Edit loads the individual resource from the backend before populating the form. Buttons/error states reflect actual operations; no payment statistics, balances or fabricated activity are displayed. Short action captions retain resource-specific accessible names and fit mobile layouts. Browser tests wait for the actual Disabled status and independently inspect D1 before recording screenshots, rather than treating a pending disabled button as successful persistence.

Desktop 1280×900 and mobile 390×844 were exercised with local fixture records. `.wrangler/sg03-desktop.png` and `.wrangler/sg03-mobile.png` are ignored local test screenshots, not production activity. No real MetaMask/hardware wallet or public hosting was used.

## Verification and actual results

| Command/check                                                       | Result                                                                                                    |
| ------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                     | PASS, frontend/server TypeScript and Vite                                                                 |
| `npm run lint`                                                      | PASS                                                                                                      |
| `npm run format:check`                                              | PASS                                                                                                      |
| `npm test`                                                          | PASS: 17 foundation + 14 compatibility + 14 SG-03 integration check groups                                |
| `npm run test:foundation`                                           | PASS, unchanged 17 SG-02 checks including real local D1 read/write and health UI                          |
| `npm run test:compatibility`                                        | PASS, unchanged 14 x402/CDP checks                                                                        |
| `npm run test:sg03`                                                 | PASS, 14 integration groups with actual Pages/workerd/D1 and genuine local signatures                     |
| `npm run build:functions`                                           | PASS                                                                                                      |
| Production Functions metafile inspection                            | PASS: health + SG-03 API modules; no test/local-control, x402 or CDP input modules                        |
| Standalone local migration command, repeat and root Pages reuse     | PASS, applied once/checksum skip; real nonce API HTTP 200 on reused local state                           |
| Stock `wrangler d1 migrations list SIGNALARC_DB --local`            | **FAIL, exit 1**, documented missing configured DB identity; local helper above succeeds without fake IDs |
| `npm audit`                                                         | **FAIL, exit 1, seven high-severity affected package records**                                            |
| Read-only diff of historical reports/SG-02 tests/health/Wrangler/CI | Empty; preserved                                                                                          |

The SG-03 groups cover migration idempotency/foreign keys; HTTPS cookie policy and unsafe HTTP configuration; wrong network/wallet/origin/CSRF; real invalid signer and altered SIWE; nonce/message expiration; simultaneous nonce reuse; session hash storage/rotation; ownership on list/read/edit/disable; price/URL/JSON/redirect/body limits; persisted updates/soft-disable; session expiration/logout replay; actual browser API integration and mobile layout. Payment attempt/receipt tables remain empty in the isolated test database.

Test-only expiry changes and database inspection occur through a generated loopback control route that is never imported into production Functions. All tests use fresh local state and clean up their own processes/state. Signing keys are generated in the isolated Node test process, never printed/persisted or transferred to frontend JavaScript. Browser EIP-1193 transport is **simulated**; its signing callback produces real ECDSA signatures verified by the unchanged production handler. Backend success responses are not mocked.

An HTTPS cookie-policy branch is exercised in local workerd with a synthetic HTTPS Request/configuration, not through deployed TLS. Local browser authentication itself uses the explicitly permitted loopback HTTP cookie mode. Real wallet-vendor prompts, public TLS cookies, multi-instance remote D1 performance and production hosting remain unverified.

### Failures and warnings encountered

- The initial TypeScript build found wagmi v3's required signing-account argument and Cloudflare's TextDecoder `ignoreBOM` typing requirement; both were corrected using the installed types.
- ESLint rejected control-code regex literals; equivalent character-code validation fixed the issue without disabling the rule.
- One early browser run used the prior SG-02 bundle because the preceding build had failed, and timed out waiting for the workspace. Rebuilding resolved it; the final browser flow passes.
- Vite reports a nonfatal `node:worker_threads` browser externalization warning from an unused `ox/tempo` dependency branch. The app invokes no Tempo/worker-thread operation, and tested wallet/auth/CRUD paths run without uncaught browser errors. This does not establish compatibility for that unused branch.
- The stock local migration listing and dependency audit failures above remain accurately reported, not disguised as passing checks.

## Security findings, limitations and owner actions

GHSA-mrhx-c7xc-m3w5 remains unresolved through Zod 3.25.76. The audit still has seven high-severity affected package records (Zod, abitype, CDP, core/EVM/SVM/extensions), with no additional advisory identified from the new dependencies in this audit. No forced repair, major override, advisory suppression or SDK upgrade was applied. New public validation does not use x402 payment parsing; the existing dependency issue is not claimed fixed. The existing CI audit job remains visibly failing.

Local tests are not an external security audit or production proof. Before any public release, review authentication abuse/CPU/storage limits, production origin/cookie/TLS configuration, real-wallet compatibility, D1 operational behavior and dependency remediation. No free-tier load/cold-start benchmark or paid service was configured. Public DNS/rebinding/redirect-safe fetching is deliberately absent, and ERC-1271/6492 contract authentication remains unsupported. CDP credentials, live authentication, real payment authorization and settlement remain unverified and unused.

No external approval is needed to rerun the local proof. Owner approval/provisioning is required for any future real D1 binding, deployment, public origin, Git publication or live payment operation; none was performed or requested here. The owner still performs every Git mutation. No remote database creation, production migration, deployment, DNS change, transaction, ETH/USDC spending, public testnet, production key/credential generation or unrelated repository modification occurred.

**SG-03 remains officially IN PROGRESS.** Review this local diff and evidence before deciding phase acceptance. No canonical roadmap checkbox was changed; no SG-04 work was started.

## Primary sources used

- [EIP-4361 SIWE specification](https://eips.ethereum.org/EIPS/eip-4361).
- [Viem SIWE parsing](https://viem.sh/docs/siwe/utilities/parseSiweMessage), [message validation](https://viem.sh/docs/siwe/utilities/validateSiweMessage), [EOA message recovery](https://viem.sh/docs/utilities/recoverMessageAddress). Official Markdown documentation and installed 2.57.13 source/types were inspected when the web renderer could not display Markdown responses.
- [Wagmi React setup](https://wagmi.sh/react/getting-started), plus installed 3.7.9 hook/core declarations for account signing and connection state.
- [Cloudflare D1 batch transaction semantics](https://developers.cloudflare.com/d1/worker-api/d1-database/#batch) and installed Wrangler local binding implementation.
- [Known Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
