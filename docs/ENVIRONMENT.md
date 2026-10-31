# Server configuration and local D1

SignalArc Gate targets **Base Mainnet only**, chain ID **8453**, CAIP-2 identifier **eip155:8453**. No public test network is configured.

| Name              | Scope                   | Requirement                                                                                                                                        |
| ----------------- | ----------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BASE_CHAIN_ID`   | Server, nonsecret       | String `8453`; configured in `wrangler.jsonc`. Missing or different values fail foundation validation.                                             |
| `SIGNALARC_DB`    | Server D1 binding       | Required when a D1 consumer calls `readFoundationConfig`. Must expose D1 `prepare` and `batch` methods. Supplied locally with `--d1 SIGNALARC_DB`. |
| `SG02_LOCAL_ONLY` | Isolated test project   | String `yes` enables the D1 fixture only with a loopback request and loopback Pages URL. Never set in production.                                  |
| `CF_PAGES_URL`    | Wrangler/Pages metadata | The isolated test project explicitly supplies `http://127.0.0.1`; public URLs are rejected by its D1 fixture.                                      |

`server/config.ts` validates only the bindings/configuration needed by the current foundation. It returns typed D1 access and the fixed Base Mainnet identifiers. Errors contain configuration names and requirements, never supplied values. It is a server-only module: do not import it into `src/`.

The unchanged `/api/health` is a basic liveness route, not a D1 readiness endpoint. It remains available without D1 and does not enumerate bindings, configuration values or credentials. The validator is invoked by the isolated D1 consumer and is ready for future server consumers; there is no global startup requirement for features that are not implemented.

## Local development without a database identifier

The [Pages D1 binding documentation](https://developers.cloudflare.com/pages/functions/bindings/#interact-with-your-d1-databases-locally) supports passing D1 bindings directly to `wrangler pages dev`. Installed Wrangler 4.154.0 accepts a binding name without a remote identifier and assigns a local identity. The core Pages local-binding mechanism established in SG-02 is:

```sh
wrangler pages dev dist --ip 127.0.0.1 --d1 SIGNALARC_DB
```

This is local emulation. There is intentionally **no `d1_databases` block or fabricated production ID** in `wrangler.jsonc`. Local dev state is under ignored `.wrangler/`; isolated tests use separate temporary state and remove it. No remote database creation or account credential is involved.

`npm run test:d1` generates a native Pages Function in a temporary project and executes this parameterized query through the real local D1 binding:

```sql
SELECT ? AS chainId, ? + ? AS calculation
```

Bindings are 8453, 19 and 23. The returned chain ID and arithmetic result 42 prove actual local SQL execution. This original SELECT check is retained, and the suite now also proves writes and persisted reads across separate loopback HTTP requests.

### Isolated local read/write acceptance test

Each runner invocation creates a fresh `.wrangler/sg02-foundation-*` project and a unique `--persist-to` state directory. Its generated Wrangler configuration has no remote database ID, remote binding or service, and the only D1 binding is the local `--d1 SIGNALARC_DB`. No application data or another test run's database is opened.

The fixture creates only this test table:

```sql
CREATE TABLE sg02_local_d1_write_probe (
  id TEXT PRIMARY KEY,
  marker TEXT NOT NULL,
  chain_id INTEGER NOT NULL,
  revision INTEGER NOT NULL
)
```

The runner first queries `sqlite_master` and asserts the table is absent, then performs these fixed actions in separate HTTP requests:

| Action  | SQL and observed assertion                                                                                                                                                    |
| ------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Create  | Prepared `CREATE TABLE`; table exists and is empty.                                                                                                                           |
| Insert  | Prepared `INSERT ... VALUES (?, ?, ?, ?)` binds `sg02-local-record`, `inserted`, 8453, 1; D1 reports one changed row.                                                         |
| Read    | A later request SELECTs the exact row `{id: "sg02-local-record", marker: "inserted", chainId: 8453, revision: 1}`.                                                            |
| Update  | Prepared `UPDATE ... SET marker = ?, revision = ? WHERE id = ?` binds `updated`, 2, `sg02-local-record`; one changed row. A later SELECT verifies the exact updated contents. |
| Delete  | Prepared `DELETE ... WHERE id = ?` binds `sg02-local-record`; one changed row. A later SELECT verifies the table is empty.                                                    |
| Cleanup | Runner `finally` calls prepared `DROP TABLE IF EXISTS sg02_local_d1_write_probe`. A separate bound metadata query verifies `tableExists: false` and `rows: []`.               |

Identifiers and SQL are fixed test code, not request parameters. Every applicable value is bound. State is read from D1 results, not an in-memory record. The test data is deterministic and is not a production record, payment receipt or product metric. No application schema or migration is created.

All `/d1-probe/*` actions exist only in the temporary fixture. They retain loopback host, exact local Pages URL, explicit `SG02_LOCAL_ONLY=yes` and Base Mainnet configuration checks. Mutation actions require POST; reads require GET. Before any write action, native D1 metadata must identify `served_by: "miniflare.db"`, otherwise the fixture fails closed. This is additional protection; isolation primarily comes from the runner's local-only binding and fresh state configuration.

The generated test worker disables global `fetch`, with a runtime rejection test, so it cannot fetch public Cloudflare or other public endpoints. Local D1 uses its native binding transport. No interception or test route is added to production Functions. Tests verify that the normal application exposes neither GET state nor POST create probe data. Cleanup still runs if an intermediate assertion fails, and the runner removes its entire temporary project/state when it exits normally or through its error handler.

Verified results: `npm run test:d1` passes **10** checks; `npm run test:foundation` passes **17** checks, and `npm test` also retains all **14** compatibility checks. INSERT, UPDATE and DELETE each report exactly one changed row. The read results above are asserted against exact contents; final cleanup returns `{tableExists: false, rows: []}` from actual D1 metadata inspection. The original health endpoint remains unchanged. `npm audit` still exits 1 with seven high-severity affected package records; this database proof does not fix the Zod advisory.

A future owner-approved production setup must create/select a real D1 database and configure the real `SIGNALARC_DB` binding/identifier in Cloudflare or Wrangler. That future operation is not performed here. SG-02 did not create application schemas; the SG-03 local application migration is described below.

## Future CDP credentials

`CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` are the existing SDK's facilitator-authentication names. They are **not required by the current screen, health endpoint, D1 proof or compatibility tests**. No environment file is created, and no credential is requested or generated.

If authenticated integration is later approved, provide those names only through server-side Cloudflare secret bindings and validate them at the point of use. Never use a `VITE_` prefix, import server environment objects into React, return credentials in API responses, or log configuration values. A CDP wallet secret is not needed merely to authenticate the facilitator. JWT signing and live CDP authentication/settlement remain unverified.

The existing compatibility harness's loopback bindings (`SG02A_LOCAL_ONLY`, `MOCK_ORIGIN`) remain test-only and unchanged. No live payment endpoint is contacted. The Zod advisory remains a production security/release concern despite local input limits.

## SG-03 authentication and application schema

SG-02 is owner-approved complete. The SQL above remains its isolated smoke fixture. SG-03 adds the actual application migration `migrations/0001_sg03.sql`, separate from the SG-02 probe table. No remote database or production identifier is created.

| Name            | SG-03 requirement                                                                                                                                                                                        |
| --------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `APP_ORIGIN`    | Exact server-side origin, including any local port and no trailing slash/path. Required for authentication and resource API routes. Public origins must be HTTPS. Never inferred from forwarded headers. |
| `APP_ENV`       | Only literal `local` permits HTTP, and only on `127.0.0.1` or `localhost`. HTTPS remains the secure default. No public HTTP exception exists.                                                            |
| `BASE_CHAIN_ID` | Existing string `8453` remains mandatory; no alternate network is configured.                                                                                                                            |
| `SIGNALARC_DB`  | Existing native D1 binding now holds merchants, nonces, sessions and resource configuration, plus empty payment/analytics foundations.                                                                   |

### Run the actual local application

```sh
npm run build
npm run db:migrate:local
npm run pages:dev
```

The dev wrapper selects a free loopback port and passes `APP_ENV=local` and the actual `APP_ORIGIN` for that port to Wrangler. `npm run pages:dev -- --port 8788` selects a specific free port. Visit `/manage` to connect an injected EOA wallet and manage resources. Root `/` and `/api/health` remain available with their previous behavior.

The migration tool starts a temporary loopback native Pages/D1 process, loads the reviewed SQL files, and applies each file in a D1 transaction. Its `local_migrations` ledger records filename, SHA-256 digest and timestamp; repeat application verifies digests and skips existing files. It uses `.wrangler/state`, the same local state as the dev server. For isolated disk state, `npm run db:migrate:local -- --persist-to <local directory>` is supported. There is **no remote option**. Only a local binding is supplied, and D1 metadata must report `miniflare.db` before SQL runs.

Installed Wrangler's stock `d1 migrations list SIGNALARC_DB --local` fails with `Couldn't find a D1 DB with the name or binding 'SIGNALARC_DB' in your wrangler.jsonc file.` Its config-driven D1 commands require a declared database identity. The local helper avoids fabricating one by using the supported Pages binding. The helper's ledger is local tooling, not a claim that production Wrangler migrations have been provisioned. Current migration files use simple statements without triggers or semicolons in literals; future complex SQL needs a reviewed splitter/loader change.

The standalone helper was tested with isolated disk state, then a normal root Pages process reused that state and returned HTTP 200 from the real nonce API. No account credentials, remote migration or public endpoint was used. Migration control routes exist only in the temporary project and disappear when the helper stops.

### Sessions and CSRF

The nonce API creates a cryptographically random 256-bit alphanumeric challenge valid for five minutes. A separate HttpOnly browser challenge cookie is hashed in D1 and bound to that nonce, wallet, exact origin and exact server-created SIWE message. Signature verification supports only standard 65-byte EOA EIP-191 signatures; ERC-1271/6492 contract signatures are explicitly rejected without RPC fallback.

A successful verification atomically consumes the nonce, creates/locates the verified merchant, inserts a session hash and revokes the previous browser session. The nonce claim is tied to the newly generated session hash inside one D1 batch. A concurrent losing verifier cannot create a second session. New challenges opportunistically delete expired nonce/session rows; active sessions do not depend on retaining their expired nonce.

Sessions last eight hours with server-enforced expiration. Only SHA-256 hashes of random 256-bit tokens are stored. Production cookies are `__Host-sg_session` and `__Host-sg_challenge`, with Secure, HttpOnly, SameSite=Strict and Path=/, and no Domain. Explicit local HTTP uses `sg_session` and `sg_challenge` without Secure; the other protections remain. Cookies are bound to the configured origin in D1. Changing the local dev port requires a new sign-in. No session token is returned in JSON or stored in localStorage.

Every POST/PATCH/DELETE API operation requires exact same-origin `Origin`, `X-SignalArc-Request: 1` and `Content-Type: application/json`. No CORS grant exists; cross-site Fetch Metadata is rejected too. This origin/custom-header policy plus Strict cookies provides CSRF protection without returning a session secret to JavaScript. GET session status returns `authenticated: false` for invalid/expired tokens; protected resource operations return 401. Logout revokes the current server-side token, clears cookies and is idempotent.

### Resource configuration and deferred execution

Authenticated sessions, not client-supplied wallet/merchant IDs, determine ownership. Registration and edits accept a name, HTTPS public-hostname URL, canonical positive `priceAtomic` USDC integer string, validated nonzero payout address, JSON response configuration, fixed network `eip155:8453`, and boolean enabled status. `priceAtomic` supports 1–999999999999 atomic units (0.000001–999999.999999 USDC). Decimal UI conversion uses BigInt and six decimals, never floating-point arithmetic. A merchant can hold at most 100 resources; listing returns the complete bounded set.

Response configuration is `{type: "json", maxBytes: 1024..1048576, redirects: "error"}`. These settings are persisted configuration, not evidence that any upstream response has been fetched. Credentials in URL authority, non-HTTPS schemes, unsupported ports, fragments, IP literals of every kind, localhost/special-use names and malformed hostnames are rejected. Public DNS aliases can still resolve to private addresses: **no DNS/rebinding or redirect execution safety is claimed**. SG-03 never fetches the URL, follows redirects, serves paid content or acts as a proxy. Those operations remain disabled until a separately reviewed later-phase implementation can fail closed.

JSON requests are streamed with a 16 KiB limit and an eight-level nesting bound before decoding/validation. SIWE messages are capped at 4096 characters. Nonce creation is bounded to 32 live challenges per wallet and 200 per requester IP/origin over five minutes; rate/CPU/storage behavior under production abuse remains unverified. All SQL values use bound parameters. Resource reads and modifications always constrain merchant ownership.

`npm run test:sg03` exercises native production API handlers in isolated local D1/workerd. Only the injected browser provider is a simulated fixture; signatures and backend verification are real. Test signing keys remain in Node memory and are never printed, written to disk or sent to the browser. HTTPS cookie policy is checked locally, not through a deployed TLS origin. Live wallets, public hosting, remote D1 and contract authentication remain unverified or unsupported. The Zod advisory is unchanged and remains a release concern; no public x402 parsing or settlement route is introduced.

## SG-06 reporting and release configuration

`/api/reporting/summary`, `/api/reporting/attempts` and `/api/reporting/receipts` use the existing `SIGNALARC_DB`, `BASE_CHAIN_ID` and exact `APP_ORIGIN`. They require the actual merchant session; no new secret or client-supplied merchant identifier is supported. `0003_sg06_reporting_indexes.sql` adds query indexes only. Earlier migration checksums/history remain unchanged; run the same local helper to apply the forward migration.

Reporting distinguishes consistent `local_simulation` records and unverified data. There is no approved production evidence admission pipeline. `verified.available = false` and null verified totals are intentional fail-closed behavior; an evidence_kind string or client transaction hash alone is not Mainnet proof. No reporting option enables payments or writes receipt evidence.

The SG-06 harness uses `SG06_LOCAL_ONLY=yes` only in an isolated generated project with loopback origin and native local D1 metadata checks. Never add it, SG-05 mock bindings or test routes to production configuration. The ordinary router does not import any payment fixture.

`public/_headers` supplies security policy for static assets. Cloudflare does not apply that file to Functions responses, so authenticated API JSON also sets explicit nosniff, no-referrer, anti-framing and no-store policy. The existing health behavior is preserved. Deployed HTTPS/browser wallet and custom-domain policy still need owner-approved verification.

Actual server configuration names remain `APP_ORIGIN`, `BASE_CHAIN_ID`, `SIGNALARC_DB` and the explicit local-only `APP_ENV` exception. Future authenticated facilitator credentials use the SDK's `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` names **only as server secrets**; no values are requested or read here. Genuine registry observation, DNS/connection-safe upstream transport, payment reconciliation and production clock/admission are not configurable production capabilities yet. Do not invent corresponding environment values or a registry address. See the non-executing [release checklist](RELEASE_CHECKLIST.md) for approval requirements.
