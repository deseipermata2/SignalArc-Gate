# SignalArc Gate

A Base-native x402 API monetization gateway for developers, targeting USDC on **Base Mainnet (chain 8453)**. The current SG-02 foundation includes a live service-health screen, native Cloudflare Pages Functions, isolated local D1/configuration tests, and the existing x402/CDP compatibility proof. Payment execution is not enabled.

## Local setup

Use Node.js **22.22.2** (the CI version) and the locked npm dependencies:

```sh
npm ci
npm run build
npm run pages:dev
```

Open the loopback URL printed by Wrangler. `pages:dev` serves `dist` and native Functions, adds the local `SIGNALARC_DB` D1 binding, and uses `BASE_CHAIN_ID=8453` from `wrangler.jsonc`. No Cloudflare login, remote database, production database ID, or CDP credentials are needed. Append `-- --port 8788` or another free port if needed. Never stop unrelated processes to free a port.

For frontend-only editing, `npm run dev` starts Vite. Its standalone server does not provide `/api/health`; the screen reports that failure. Rebuild and use Pages dev for the complete local application. There is no proxy to a live payment service.

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

`npm test` runs the new foundation checks followed by the unchanged 14-check compatibility suite. The foundation runner tests actual local D1/Pages execution and the browser UI, including loading, real health success, HTTP failure, retry, malformed response and mobile layout. Browser tests block non-local requests. Test-only error responses are explicitly browser fixtures, not payment activity. On a minimal Linux system, browser libraries may first require `npx playwright install --with-deps chromium --only-shell`.

Useful focused commands:

- `npm run test:d1`: local SQL, configuration validation and isolation only; no browser launch.
- `npm run test:ui`: Pages health and Chromium UI checks against built `dist`.
- `npm run test:compatibility`: existing isolated x402/CDP workerd proof.
- `npm run format`: format active project files. Historical reports and compatibility evidence are intentionally excluded.

D1 and payment probe routes are generated exclusively in temporary test projects, not in production `functions/`. Foundation tests use their own local D1 state and parameterized SELECT statements. They create no application schema or records. Temporary state is removed; browser screenshots are saved under ignored `.wrangler/`.

## Configuration and boundaries

See [environment configuration](docs/ENVIRONMENT.md) for binding/variable names and server-side validation. See [SG-02 report](docs/SG-02_REPORT.md) for evidence and limitations. Historical [compatibility](docs/COMPATIBILITY_REPORT.md) and [packaging/security](docs/SG-02B_REPORT.md) reports are preserved.

The known Zod advisory **GHSA-mrhx-c7xc-m3w5 remains unresolved**. `npm audit` currently fails; input bounds in local fixtures do not fix the dependency. The CI audit job deliberately reports this failure. Do not interpret successful local tests as a production security audit or real payment settlement proof.

SG-02 awaits owner review. No roadmap phase is automatically completed. The owner performs all Git mutations and publishing; local CI configuration performs no deployment.
