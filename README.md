# SignalArc Gate

A Base-native x402 API monetization gateway for **Base Mainnet, chain 8453**, using native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

SG-00 through SG-05 are owner-approved complete. **SG-06 is IN PROGRESS. Public payment execution and production release remain BLOCKED.** Local gateway tests simulate settlement; they do not prove a Mainnet payment.

## What works locally

- Injected EVM wallet connection and EOA Sign-In with Ethereum, with D1-backed nonce/session security.
- Merchant-owned HTTPS/JSON resource creation, editing, pricing, payout configuration and disabling at `/manage`.
- Authenticated payment history, receipt provenance and bounded usage reporting. Internal simulations and unverified records are separated; no approved production evidence reader exists, so verified Mainnet totals are unavailable.
- An immutable, non-custodial EndpointRegistry contract tested with Foundry; no public deployment.
- An isolated x402 v2 upfront gateway with durable D1 state, replay protection and reconciliation tests. Its facilitator, registry, upstream and clock fixtures are never production routes.

The gateway does not hold merchant funds. Configuring a resource does not register it onchain, contact its upstream or enable public paid fulfillment. The registry records configuration, not payment success.

## Local setup

Use Node **22.22.2**, the locked dependencies and a compatible injected EOA wallet:

```sh
npm ci
npm run build
npm run db:migrate:local
npm run pages:dev
```

Visit the printed loopback URL. `/` shows real liveness; `/manage` contains the developer dashboard. Base Mainnet is the only configured chain. Signing in authorizes no transaction/payment. Keys and seed phrases are never entered into this application. Contract-wallet authentication remains unsupported.

Pages dev chooses a free port and supplies the exact `APP_ORIGIN`, explicit local HTTP mode and `SIGNALARC_DB` local binding. `npm run pages:dev -- --port 8788` requests a particular free port without terminating occupied processes. Local migrations use `.wrangler/state`, verify checksums and apply forward SQL transactionally. No remote D1 ID, account credential or remote mode is configured. See [environment details](docs/ENVIRONMENT.md).

`npm run dev` is frontend-only Vite development; it does not provide the native backend. Rebuild and use Pages dev for the complete local app.

## Documentation

- [Developer onboarding and privacy](docs/ONBOARDING.md)
- [API and agent quickstart](docs/API_QUICKSTART.md)
- [Release blockers and non-executing launch approval packet](docs/RELEASE_CHECKLIST.md)
- [SG-06 implementation and QA evidence](docs/SG-06_REPORT.md)
- Historical [SG-03](docs/SG-03_REPORT.md), [SG-04](docs/SG-04_REPORT.md), [SG-05](docs/SG-05_REPORT.md), [compatibility](docs/COMPATIBILITY_REPORT.md) and [CDP packaging](docs/SG-02B_REPORT.md) evidence

Historical reports retain their original findings and review status; the owner's later approvals govern the current phase baseline.

## Verification

```sh
npx playwright install chromium --only-shell
npm run build
npm run lint
npm run format:check
npm test
npm run build:functions
npm audit
```

On minimal Linux installations, Chromium may need system libraries installed by the owner. Individual suites: `test:foundation`, `test:compatibility`, `test:sg03`, `test:sg05`, `test:sg06`. `test:d1` remains the focused SG-02 read/write probe. Automated wallet providers and payment settlements are explicitly local fixtures; signatures and native Pages/D1 execution are real local tests. No live CDP credentials, funded wallets or blockchain services are required.

From `contracts/`, run `forge fmt --check`, `forge build`, `forge test -vvv`, and `forge test --gas-report`. Foundry is pinned to Solidity 0.8.28 and offline mode locally. The CI contract job permits a verified compiler download on a fresh runner; it never deploys or broadcasts.

## Security and release boundary

Production payment handling remains disabled. Required gates include dependency remediation, a real approved registry binding/observer, live facilitator permissions/authentication validation, authoritative reconciliation, DNS/connection-safe upstream execution, production clock/TLS verification and operational abuse budgets. No unrestricted proxy or payment retry endpoint exists.

Session cookies are HttpOnly/SameSite=Strict, and Secure with `__Host-` names over HTTPS; only explicit loopback HTTP uses non-Secure local cookies. Session tokens are hashed and never returned to browser JavaScript or placed in localStorage. The dashboard clears merchant query caches on logout/expiry and never treats a wallet connection as authentication.

Zod **GHSA-mrhx-c7xc-m3w5** and tooling dependency findings remain open; see the fresh evidence in the SG-06 report. Input limits are mitigation, not a dependency fix. Do not use forced audit repairs or unsupported overrides. This project has not received an independent security audit and is not approved for production payments.

All Git mutations, publishing, deployments, account/DNS changes and spending remain the owner's responsibility. No phase is automatically marked complete.
