# SignalArc Gate

A Base-native x402 API monetization gateway targeting USDC on **Base Mainnet (8453)**. SG-00, SG-01 and SG-02 are owner-approved complete. **SG-03 is IN PROGRESS and awaiting review.** Wallet/SIWE sessions and merchant resource configuration are implemented locally; upstream fetching and payment execution are not enabled.

## Local setup

Use Node.js **22.22.2** and the locked npm dependencies:

```sh
npm ci
npm run build
npm run db:migrate:local
npm run pages:dev
```

Open the loopback URL printed by Wrangler. `/` retains the health foundation screen; **`/manage`** connects an injected wallet, signs in with Ethereum, and manages persisted resources. Only Base Mainnet is configured. No blockchain RPC or transaction is required for EOA sign-in. Contract-signature authentication is explicitly unsupported.

`pages:dev` chooses a free loopback port and sets the exact server `APP_ORIGIN` and explicit local HTTP mode. You may supply `-- --port 8788` with a free port; occupied ports fail without terminating another process. D1 uses `--d1 SIGNALARC_DB`, with no production UUID or account credentials. The migration command applies only local SQL through native D1, checks migration digests, and retains local app state under `.wrangler/state`. It has no remote mode. Tests use separate temporary database directories and remove their own state.

For frontend-only editing, `npm run dev` starts Vite, which does not supply the native API. Rebuild and use Pages dev for the full app. No proxy to a live facilitator or untrusted upstream is configured.

## Verification

```sh
npx playwright install chromium --only-shell
npm run format:check
npm run build
npm run lint
npm test
npm run build:functions
npm audit
```

On minimal Linux systems, Chromium libraries may require `npx playwright install --with-deps chromium --only-shell`.

- `npm run test:foundation`: the unchanged SG-02 D1/read-write/configuration and browser checks.
- `npm run test:d1`: focused SG-02 local D1 smoke checks.
- `npm run test:compatibility`: the unchanged x402/CDP workerd proof.
- `npm run test:sg03`: actual migrations, SIWE signature verification, nonce races, cookies/sessions, CSRF, ownership, validation and CRUD in local Pages/D1, plus desktop/mobile browser integration.
- `npm run format`: format active files while preserving historical reports and compatibility evidence.

`npm test` includes all three suites, so the existing CI quality job includes SG-03 automatically. Its separate audit job intentionally remains failing for the unresolved Zod advisory. The new browser test uses an **explicitly simulated injected provider** backed by real ECDSA signatures from ephemeral local test keys kept only in Node memory. API/backend successes are not mocked. No test key is printed, persisted or sent to frontend JavaScript. External browser/worker fetch is blocked in test fixtures.

## Configuration and boundaries

See [environment and local D1 configuration](docs/ENVIRONMENT.md), [SG-03 evidence](docs/SG-03_REPORT.md) and the preserved [SG-02 report](docs/SG-02_REPORT.md). Historical [compatibility](docs/COMPATIBILITY_REPORT.md) and [packaging/security](docs/SG-02B_REPORT.md) reports remain unchanged.

Production authentication requires an owner-supplied exact HTTPS `APP_ORIGIN` and a real D1 binding. Neither is provisioned or deployed here. Session cookies are HttpOnly/SameSite=Strict and Secure with `__Host-` names over HTTPS. Only explicit loopback development permits non-Secure local cookies. Session tokens are hashed in D1 and never returned to JavaScript or stored in localStorage.

Resource registration validates and stores configuration; it never contacts the upstream. DNS/rebinding checks and safe response delivery remain deferred. No public payment parsing, proxy, settlement, analytics dashboard or fabricated payment activity is introduced.

**GHSA-mrhx-c7xc-m3w5 remains unresolved.** `npm audit` currently fails. No forced fix or incompatible override is used, and the application is not claimed to be security-audited or production-ready. All Git mutations, publishing and deployments remain the owner's responsibility. No roadmap checkbox is automatically changed.
