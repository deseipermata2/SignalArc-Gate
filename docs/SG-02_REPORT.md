# SG-02 — Technical foundation review

Status: **Ready for owner review; official SG-02 remains IN PROGRESS.** No roadmap checkbox was changed. No later phase was started. This is a local technical foundation report, not production payment or security approval.

## 1. Existing project and inspection

The repository began clean at owner-created commit `99bd81d` (`99bd81dde464b5987a0b0671441da889fa359…`). It already contained React 19.3.1, Vite 8.3.5, TypeScript 5.9.3, Tailwind CSS 4.3.3 through the Vite plugin, ESLint 10.13.0, Wrangler 4.154.0, native Pages health, and the successful CDP/Foundation compatibility proof. Node 22.22.2 and npm 10.9.7 were used locally.

Inspected the structure, manifest/lockfile, Vite/Wrangler/TypeScript configurations, health function, compatibility fixtures, Git status/log, and historical technical reports before editing. The approved `SIGNALARC_GATE_PROJECT_RULES_V2.md`, `SIGNALARC_GATE_ROADMAP_V2.md`, and applicable AGENTS.md were not found locally. The owner's prompt supplied the governing scope and restrictions; no replacement rules were invented.

Baseline build, lint and all 14 compatibility checks passed. Historical reports and `tests/compatibility/` remain byte-for-byte unchanged. The health function remains unchanged. Git was used only for read-only inspection; no Git mutation, credential/configuration change, commit, push, remote operation or publication was performed.

The subsequent read/write acceptance continuation found the existing uncommitted foundation work and preserved it. That continuation changes only `tests/foundation/handler.ts`, `tests/foundation/run.mjs`, `docs/ENVIRONMENT.md` and this report. It adds no dependency, configuration, production route or official phase identifier.

## 2. Exact source changes

Modified:

- `README.md`: real local setup, scripts and known limitations instead of starter guidance.
- `index.html`: product title and description.
- `package.json`, `package-lock.json`: pinned UI/test/format/type dependencies and useful scripts.
- `public/favicon.svg`: small product monogram replacing the starter icon.
- `src/App.tsx`, `src/App.css`, `src/index.css`: functional product foundation screen and Tailwind v4 theme.
- `tsconfig.json`, `tsconfig.app.json`, `vite.config.ts`: aligned `@/*` imports; root TypeScript build also checks server/Functions types.
- `wrangler.jsonc`: nonsecret `BASE_CHAIN_ID` string `8453`; existing name, output directory and compatibility date unchanged.

Created:

- `.github/workflows/ci.yml`
- `.prettierignore`, `.prettierrc.json`
- `components.json`
- `docs/ENVIRONMENT.md`, `docs/SG-02_REPORT.md`
- `server/config.ts`
- `src/components/ui/button.tsx`, `src/components/ui/card.tsx`, `src/components/ui/LICENSE.md`
- `src/lib/utils.ts`
- `tests/foundation/handler.ts`, `tests/foundation/run.mjs`
- `tsconfig.functions.json`

Build/state/screenshot artifacts are under ignored `dist/` and `.wrangler/`. The default Functions command's generated `_worker.bundle` was removed after verification. Existing unused starter assets were preserved; they are not used by the new screen. No empty scaffold, environment file, migration, application database schema, or invented production record was added.

## 3. Dependencies

| Added direct package              | Exact version | Purpose                                         |
| --------------------------------- | ------------- | ----------------------------------------------- |
| `@radix-ui/react-slot`            | 1.5.0         | shadcn Button composition primitive             |
| `class-variance-authority`        | 0.7.1         | shadcn Button variants                          |
| `clsx`                            | 2.1.1         | Conditional UI class names                      |
| `tailwind-merge`                  | 3.7.0         | Resolve Tailwind class overrides                |
| `@cloudflare/workers-types` (dev) | 5.20261028.1  | Native server/D1 type checking                  |
| `playwright` (dev)                | 1.64.1        | Real Chromium UI smoke and failure-state checks |
| `prettier` (dev)                  | 3.9.10        | Formatting and formatting checks                |

Lockfile comparison against HEAD: **9 package entries added, zero removed, zero existing package versions changed**. All x402 packages remain 2.28.0, CDP remains 1.60.0, and Zod remains 3.25.76. No force/legacy peer flags, major SDK upgrade, alternate framework or provider was introduced.

## 4. shadcn/ui and frontend

Followed the official existing-project Vite setup. Kept the Tailwind v4 Vite plugin, configured `@/*` in both relevant TypeScript configurations and Vite, added shadcn `components.json`, and integrated Button/Card from the official new-york-v4 registry. Registry code is local source, with its MIT license retained. Imports use the narrow Radix Slot package and the standard local `clsx`/`tailwind-merge` utility rather than installing an entire component primitive barrel. No project generator or reinitialization was run.

The screen identifies SignalArc Gate as a Base-native x402 API monetization gateway, shows Base Mainnet/8453 and USDC/x402, and fetches **this application's actual `/api/health`**. It implements loading, valid response, HTTP/network/timeout error, malformed response, and retry states. The refresh control is disabled while loading. Returned data is checked against the exact expected health contract; only those fields are rendered, without echoing unexpected response fields. No payment counters, revenue, users, balances or activity are invented.

Chromium rendered the actual Pages-served production build at desktop 1280×900 and mobile 390×844. Tests asserted shadcn data slots, the compiled Tailwind primary color, the exact real health response, loading state, HTTP 503 handling/retry, malformed-contract rejection, no horizontal overflow, and no uncaught browser errors. Loading/error fixtures intercept only the browser health request; they do not simulate successful payments. Browser non-local requests are blocked.

Desktop and mobile screenshots were generated and visually inspected at `.wrangler/sg02-desktop.png` and `.wrangler/sg02-mobile.png`. They show the real local health response. These are ignored local verification artifacts, not published assets or production evidence.

## 5. Local D1 proof

Used Wrangler's local Pages binding mechanism, **`--d1 SIGNALARC_DB`**, with no `d1_databases` block or production identifier in configuration. Installed Wrangler accepts a binding name alone and creates a local identity, reported as `local-SIGNALARC_DB`. The permanent `pages:dev` script makes this local setup reproducible. No remote database was created and no Cloudflare login/account credential was needed.

The D1 smoke runner creates a temporary native Pages project, copies the unchanged health route, adds a wrapper importing the isolated D1 fixture, supplies local bindings, and starts actual Wrangler/workerd on a free loopback port. Inspector ports and persistent-state paths are isolated too. The Function uses the real D1 binding's `prepare`, `bind` and `first` APIs to execute:

```sql
SELECT ? AS chainId, ? + ? AS calculation
```

Parameters: 8453, 19, 23. Observed HTTP 200 result:

```json
{
  "localOnly": true,
  "network": "eip155:8453",
  "chainId": 8453,
  "calculation": 42
}
```

This original SQL test calculation is retained, but SELECT alone did not establish the required D1 write acceptance criterion. The suite now also creates and drops a test-only table in its isolated local database. No application record or production schema is created. Test state and temporary projects are removed after execution; only the runner's own process groups are stopped.

### Local read/write acceptance evidence

The runner first proves `sg02_local_d1_write_probe` is absent in its fresh database, then creates it with the fixed test schema `(id TEXT PRIMARY KEY, marker TEXT NOT NULL, chain_id INTEGER NOT NULL, revision INTEGER NOT NULL)`. INSERT, UPDATE and DELETE use prepared statements with bound values. SELECTs run in **separate loopback HTTP requests**, demonstrating persisted database contents rather than an in-memory echo:

| Step                     | Actual D1 evidence                                                                                                              |
| ------------------------ | ------------------------------------------------------------------------------------------------------------------------------- |
| CREATE                   | `tableExists: true`, `rows: []`.                                                                                                |
| INSERT                   | Bound values `sg02-local-record`, `inserted`, 8453, 1; `meta.changes` is 1.                                                     |
| Separate SELECT          | Exactly `[{"id":"sg02-local-record","marker":"inserted","chainId":8453,"revision":1}]`.                                         |
| UPDATE                   | Bound marker `updated`, revision 2, ID `sg02-local-record`; `meta.changes` is 1.                                                |
| Separate SELECT          | Exactly `[{"id":"sg02-local-record","marker":"updated","chainId":8453,"revision":2}]`.                                          |
| DELETE                   | Bound ID `sg02-local-record`; `meta.changes` is 1. A separate SELECT returns `rows: []` while the table still exists.           |
| DROP in runner `finally` | `tableExists: false`; a separate `sqlite_master` query, with bound type/name values, again proves table absence and `rows: []`. |

Every probe response identifies the actual emulator's `servedBy: "miniflare.db"`; the handler rejects other D1 `served_by` metadata before any write. SQL identifiers are fixed test code, and no request can supply SQL or record values. Mutation actions require POST, state reads require GET, and all original local-only/configuration guards execute first. Both read and write actions are tested against missing opt-in, public hosts and public Pages metadata.

Each invocation has a unique temporary project and `--persist-to` database directory. No production ID or remote binding is supplied: only local `--d1 SIGNALARC_DB`. The generated fixture worker blocks global network fetch before transport, verified by a runtime rejection check; native local D1 remains usable. This interception exists only in the temporary test worker. The normal application's GET `/d1-probe/state` and POST `/d1-probe/create` are checked for absence of fixture data, and a production Functions metafile is inspected for accidental fixture imports.

Cleanup runs in a `finally` block even when a lifecycle assertion fails. The runner also removes the entire temporary database directory on its success/error exit path. The fresh-table assertion prevents silently reusing an existing probe table. This establishes local persistence across requests, not remote D1 behavior, process-restart recovery or production schema readiness.

An initial diagnostic query including `sqlite_version()` failed with `D1_ERROR: not authorized to use function: sqlite_version ... SQLITE_ERROR`. The probe was corrected to supported parameterized SQL above; subsequent local tests passed. The runtime therefore establishes D1 SQL availability, not unrestricted SQLite function access.

Isolation checks reject missing local opt-in, public request hosts and public Pages metadata. Original SELECT/configuration routes remain GET-only; the new test-only write routes accept only their explicit methods. Missing binding returns 503 with a clear configuration error. Production `functions/` still contains only the original health route. Normal-app requests to `/d1-smoke`, `/configuration`, `/d1-probe/state`, `/d1-probe/create`, `/probe`, and `/challenge` receive no fixture/payment data or PAYMENT-REQUIRED header; SPA fallback HTML is not mistaken for a Function.

A future production binding requires the owner to create/select a real D1 database and configure its real identity. That external setup is intentionally not part of this local foundation. Merchant/resource/payment/wallet schemas remain deferred.

## 6. Environment validation

`server/config.ts` is a server-only module. `readFoundationConfig` requires:

- `BASE_CHAIN_ID` to be exactly string `8453`, yielding only `eip155:8453`.
- `SIGNALARC_DB` to expose native D1 `prepare` and `batch` methods.

Errors name the missing/invalid requirement but never echo the supplied value. Real-workerd tests exercise missing/invalid chain configuration and missing/invalid D1 binding. The valid path executes real SQL. The validator is used at the D1 consumer boundary; basic health remains independent of optional database features and does not enumerate bindings or secrets.

`docs/ENVIRONMENT.md` documents actual names, local commands and production follow-up requirements. Future `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET` remain server-only and are not required or read by the new screen/D1 tests. No VITE-prefixed credential, credential file or browser secret is introduced. No JWT signing or authenticated payment integration was added.

## 7. Tooling and CI

Added scripts:

- `pages:dev`: native Pages local dev plus the local D1 binding.
- `build:functions`: Pages Functions bundling into ignored `.wrangler/functions-build`.
- `test:foundation`, `test:d1`, `test:ui`: complete or focused local foundation checks.
- `test`: foundation checks followed by the unchanged compatibility command.
- `format`, `format:check`: Prettier over active project files.

Existing dev/build/lint/preview/compatibility scripts are preserved. The root build now includes a separate Cloudflare server/Functions TypeScript project without mixing its ambient types into the frontend.

Formatting intentionally excludes reviewed historical reports and the existing compatibility suite to preserve their evidence. A Prettier override keeps `wrangler.jsonc` valid JSON: the existing suite reads it with `JSON.parse`, so adding JSONC trailing commas would break it. An initial formatter-induced failure was corrected by this override without modifying the compatibility runner.

The GitHub Actions workflow uses Node **22.22.2**, locked `npm ci`, read-only repository permissions, disabled persisted checkout credentials, and no deployment steps. Its quality job runs formatting, production build, lint, Chromium installation, all automated tests and Functions build. It needs no production secrets or blockchain service. A separate **dependency-audit job runs plain `npm audit` without suppression or `continue-on-error`**, so the current known advisory leaves that job failing visibly.

The workflow was written locally and its commands tested locally. **No GitHub Actions run was triggered or observed**, since no Git mutation/push was authorized. GitHub-hosted CI execution is a future owner action. No billing or paid infrastructure was configured.

## 8. Commands and actual results

| Verification                                                                 | Actual result                                                                                   |
| ---------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| `npm run build`                                                              | PASS, TypeScript frontend/server plus Vite                                                      |
| `npm run lint`                                                               | PASS                                                                                            |
| `npm run format:check`                                                       | PASS on active files                                                                            |
| `npm run test:foundation`                                                    | PASS: 17 foundation checks, including 10 D1/configuration/isolation checks                      |
| `npm test`                                                                   | PASS: 17 foundation checks plus 14 existing compatibility checks                                |
| `npm run test:d1`                                                            | PASS: 10 native local D1/configuration/isolation checks, including persisted writes and cleanup |
| `npm run test:compatibility` (standalone and via npm test)                   | PASS: all 14 previous checks retained                                                           |
| `npm run build:functions`                                                    | PASS                                                                                            |
| `npx wrangler pages functions build`                                         | PASS                                                                                            |
| Functions build with production metafile                                     | PASS; health/routing inputs only                                                                |
| Normal Pages GET `/api/health`                                               | HTTP 200, exact prior JSON and Cache-Control preserved                                          |
| Desktop/mobile Chromium smoke                                                | PASS, actual local health success plus explicit loading/error tests                             |
| `git diff --check`                                                           | PASS                                                                                            |
| Diff of historical reports, existing compatibility suite and health function | Empty; preserved                                                                                |
| `npm audit`                                                                  | **FAIL, exit 1, seven high-severity affected package records**                                  |

Additional commands used during the foundation work: baseline read-only `git status`/`log`/`diff`/`show`, repository and SDK inspection with `rg`/`find`/`cat`, official documentation/registry reads, exact npm installs listed above, `npm run format`, `npx playwright install chromium --only-shell`, `npm ls --depth=0`, and `npm audit --json` for structured findings.

For the read/write acceptance continuation, all eight requested commands were rerun explicitly: `npm run build`, `npm run lint`, `npm run format:check`, `npm run test:foundation`, `npm run test:d1`, `npm run test:compatibility`, `npm test` and `npm run build:functions`. Every requested command passed. The earlier 11 foundation checks are retained and six write/persistence/cleanup/egress checks were added. No read/write implementation or verification failure occurred in this continuation. An additional plain `npm audit` still failed with exit 1 and seven high-severity affected package records rooted in the same unresolved Zod advisory. No repair, override or suppression was used.

The extra production bundle inspection used:

```sh
npx wrangler pages functions build --outdir .wrangler/production-inspection --metafile .wrangler/production-inspection.json
```

Its inputs were `api/health.ts`, generated Pages routing, path-to-regexp and Wrangler's Pages template. No foundation fixture, server configuration consumer or payment SDK input was included. The root production health route stays unchanged:

```json
{
  "status": "ok",
  "service": "SignalArc Gate",
  "network": "base-mainnet",
  "chainId": 8453
}
```

Header: `Cache-Control: no-store`.

## 9. x402 regression evidence and limits

All 14 existing checks passed without changing their implementation: CDP public entry-point bundling/loading, missing-credential guard, Foundation/EVM loading and Web Crypto, Base Mainnet v2 USDC challenge, malformed/mismatched/oversized authorization rejection, loopback-only transport, negative mock verification, positive mock verification without content, negative mock settlement, normal health and no production fixture exposure.

No payment endpoint or lifecycle was implemented. Real authorization, JWT signing, CDP authentication, live verification/settlement, replay handling and Base USDC settlement remain unproven. Simulated local transport is not evidence of real settlement.

## 10. Security findings and remaining risks

`npm audit` still identifies **GHSA-mrhx-c7xc-m3w5** through installed **Zod 3.25.76**. The seven affected package records are Zod, abitype, CDP SDK and the four x402 packages, propagating one underlying advisory. New foundation packages introduced no additional advisory in this audit. SDK versions were not upgraded, forced or overridden; the prior compatible-range limitation remains. No audit suppression or forced repair was applied.

The current production route tree does not expose payment schemas, but the vulnerable library remains in the runtime dependency graph. Existing fixture bounds are retained and are not a Zod fix. Compatible upstream remediation, input/rate limits and a production security/release review remain necessary before public payment handling. **The application is not claimed to be security-audited.** The CI audit job is expected to remain red until this issue is resolved.

Other limits: local D1 does not prove remote database configuration/latency; browser checks cover Chromium only; GitHub CI has not run remotely; no free-tier load/CPU/cold-start measurement was performed; live payment authentication and execution were intentionally excluded. Current root health is liveness, not database/payment readiness.

## 11. Acceptance and owner decision

The earlier report's D1 proof was SELECT-only and did not satisfy read/write acceptance. That gap is now covered by actual local CREATE, INSERT, separate SELECT, UPDATE, DELETE and verified DROP operations. The local foundation is ready for owner review alongside the existing UI, configuration, CI, build/lint/format/Functions and x402 evidence. The known audit failure is explicitly retained; not all commands passed.

No missing local technical acceptance criterion is concealed. Production D1 identity, remote CI execution, security remediation and live payments are not claimed complete and do not expand this task. No private keys, seed phrases, credentials, production records, blockchain transactions, public testnets, paid services, deployments, DNS changes or unrelated repositories were involved.

**SG-02 is ready for owner/ChatGPT review, not automatically complete.** The canonical roadmap was not changed. The owner retains all Git mutations. Review this report and the local diff, including the intentionally failing audit gate, before deciding whether to mark the official checklist complete. Do not begin SG-03 from this result.

## Official references

- [shadcn/ui: existing Vite project](https://ui.shadcn.com/docs/installation/vite), [manual installation](https://ui.shadcn.com/docs/installation/manual), [Tailwind v4 Button registry](https://ui.shadcn.com/r/styles/new-york-v4/button.json), [Card registry](https://ui.shadcn.com/r/styles/new-york-v4/card.json).
- [Cloudflare Pages D1 bindings](https://developers.cloudflare.com/pages/functions/bindings/#d1-databases), [D1 local development](https://developers.cloudflare.com/d1/best-practices/local-development/), [D1 prepared statements](https://developers.cloudflare.com/d1/worker-api/prepared-statements/).
- [Prettier file exclusions](https://prettier.io/docs/ignore), [Playwright library](https://playwright.dev/docs/library).
- [GitHub Node CI guidance](https://docs.github.com/en/actions/tutorials/build-and-test-code/nodejs), [setup-node](https://github.com/actions/setup-node), [checkout](https://github.com/actions/checkout).
- [Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5).
