# SG-02A — x402/CDP compatibility report

Date: 2026-10-28. Recommendation: **BLOCKED** for the current CDP x402 helper with the minimal Base-only dependency set. The Foundation server SDK and CDP auth subpath work in native local Cloudflare Pages Functions. This is a packaging blocker, not proof that the Workers runtime cannot support CDP.

## Boundary and baseline

Inspected package manifest/lock, Vite, Wrangler, all three existing TypeScript configurations, ESLint, README, directory layout, and health function before editing. No applicable AGENTS.md, roadmap, or additional project rules were found. The directory has no `.git` metadata; `git status --short` returned “not a git repository”. A Git baseline/diff cannot be asserted. Existing source, UI, health route, Vite, Wrangler, and TypeScript project configurations were preserved.

Baseline `npm run build` and `npm run lint`: PASS. Node 22.22.2, npm 10.9.7, TypeScript 5.9.3, Vite 8.3.5, Wrangler 4.154.0; installed workerd 1.20261023.1 and Miniflare 5.20261023.1-beta. Existing Wrangler compatibility date: 2026-10-28, no explicit compatibility flags. Baseline `npm ls` also reported three extraneous optional/runtime packages; dependency installation can reconcile npm's installed tree. No user files were reset or deleted.

All fixture network configuration is **Base Mainnet, chain 8453, `eip155:8453`**, USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`. The challenge advertises 1,000 atomic units ($0.001), a burn-address sentinel, and “LOCAL ONLY — never pay”. This is protocol construction, never an invitation to pay.

## Packages and official references

Registry latest versions were checked with `npm view`; selected versions are pinned in package.json and package-lock.json:

| Direct package | Version | Import used/probed |
| --- | --- | --- |
| `@x402/core` | 2.28.0 | `/server`, `/http`, `/schemas`, `/types` |
| `@x402/evm` | 2.28.0 | `/exact/server` |
| `@coinbase/cdp-sdk` | 1.60.0 | `/x402` (blocked bundle probe), `/auth` (runtime probe) |

Relevant locked transitives include viem 2.57.13, jose 6.2.13, uncrypto 0.1.3, and Zod 3.25.76. No test framework dependency was needed: the runner uses Node built-ins to orchestrate real Wrangler Pages processes. Node assertions alone are not the runtime evidence.

Official sources consulted:

- [Foundation facilitator protocol and HTTP headers](https://docs.x402.org/core-concepts/facilitator): transport-independent verify/settle, v2 challenge and payment headers. Its public `x402.org` facilitator is intended for development workflows; it is not assumed to support production Base payments. No public facilitator was called.
- [Foundation TypeScript server implementation](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/src/server/x402ResourceServer.ts): server registration, requirements, verification, settlement. Exact installed `.d.mts` exports and implementation were also inspected; GitHub main is not a pinned package specification.
- [CDP production configuration](https://docs.cdp.coinbase.com/x402/seller/production-configuration): currently recommends `createCdpFacilitatorClient` from `@coinbase/cdp-sdk/x402` with Foundation server and exact EVM scheme. No broad default network registration is used here.
- [CDP facilitator](https://docs.cdp.coinbase.com/x402/seller/facilitator): authenticated production facilitator, Base support, and pricing.
- [CDP seller quickstart](https://docs.cdp.coinbase.com/x402/seller/quickstart): reviewed as API guidance; its Express architecture and network defaults were not adopted.
- [Cloudflare Pages local development](https://developers.cloudflare.com/pages/functions/local-development/): `wrangler pages dev` runs Functions locally.
- [Cloudflare Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/) and [default-compatibility change](https://developers.cloudflare.com/changelog/post/2026-08-04-nodejs-compat-default/): Node compatibility is implicit for dates from 2026-08-04. No explicit flag was necessary with this project's existing date. Earlier dates would need `nodejs_compat`; changing the date is outside this spike.
- [Cloudflare runtime limits](https://developers.cloudflare.com/workers/platform/limits/): free-tier request, CPU and resource constraints require production assessment.

## Implementation and isolation

`tests/compatibility/handler.ts` uses native Request/Response, `x402ResourceServer`, `HTTPFacilitatorClient`, `ExactEvmScheme`, SDK schemas and header codecs. It builds requirements with the SDK, issues a 402 challenge, checks the envelope and server-owned requirements, and exercises verification. A separate rejection-only test path calls the HTTP client's settlement transport directly; it does not represent a valid payment lifecycle.

`tests/compatibility/run.mjs` creates a uniquely named temporary project inside `.wrangler/`, copies the unchanged health function, generates a native Pages wrapper, starts a Node HTTP mock on loopback, then starts real `wrangler pages dev` processes on dynamically selected free ports. The fixture inherits the actual project's compatibility date/flags. Its wrapper exists only in the temporary project. The runner also starts the ordinary repository Pages app against `dist` and checks its health and absence of fixture headers. It stops only its own process groups and removes only its own temporary directory.

There are no new production Functions routes or paid resources. The fixture requires an explicit local binding, loopback request hostname, loopback mock origin, and absence of a public Pages URL. Wrangler synthesizes a public-looking Pages URL locally too, so the runner explicitly binds a loopback `CF_PAGES_URL` only in its isolated fixture project. The normal project receives no such binding. Even positive mock verification always returns 402, never content or a PAYMENT-RESPONSE header. Mock settlement always fails with an empty transaction field; no fabricated successful receipt exists.

During each serial fixture invocation, a test-only fetch guard allows only the exact mock origin and `/supported`, `/verify`, `/settle`, rejects redirects, and restores fetch afterward. This isolate-wide patch is deliberately restricted to the serial harness; it is not suitable as a concurrent production adapter. Workerd rejected the initial `redirect: 'error'` guard; `manual` plus explicit 3xx rejection works. This was a harness issue, not an SDK failure.

## Reproduction and actual evidence

With the existing toolchain and locked dependencies installed:

```sh
npm run build
npm run lint
npm run test:compatibility
npx wrangler pages functions build
```

| Verification | Actual result |
| --- | --- |
| `npm run build` | PASS, TypeScript + Vite production build |
| `npm run lint` | PASS |
| Compatibility TypeScript check | PASS, including fixture and existing health route |
| `npm run test:compatibility` | PASS: 10 runtime checks, plus confirmed CDP bundle blocker |
| `npx wrangler pages functions build` | PASS for existing production Functions; generated `_worker.bundle` removed afterward |
| SDK fixture `wrangler pages dev assets` | Compiled and executed in workerd, native Pages wrapper |
| Normal app `wrangler pages dev dist` | PASS, health 200 and exact existing JSON/no-store header |
| CDP `/x402` import-only Pages bundle | FAIL, exit 1, 10 unresolved-import errors |

The runner prints `CONFIRMED BLOCKER` separately from its 10 passing checks. Its overall exit 0 means the safe runtime assertions and expected failure reproduction passed; **it does not mean CDP integration passed**. If the blocker changes, its assertion fails and requires report review.

The 10 checks cover health in the SDK fixture; Foundation/EVM/CDP-auth module execution, credential guard and Web Crypto SHA-256; four isolation guards; missing authorization/402; malformed and mismatched authorization; verify rejection without settlement; positive mock verify without content; rejection-only settlement transport; normal app health; and absence of fixture exposure in the normal app.

Observed mock traffic: 7 GET `/supported`, 2 POST `/verify`, 1 POST `/settle`. Both POST paths were the local HTTP server. Bodies were checked for v2 and `eip155:8453`. The test envelope has only `{ localOnly: true }` as scheme payload; no signature or payment authorization was generated or submitted.

## Exact CDP blocker and smallest alternatives

The installed SDK declares `@x402/svm` and `@x402/extensions` as **optional peers** (`^2.25.0`). Its public `/x402` barrel statically exports server/client modules that import those peers. Wrangler resolves those imports before removing unused exports, even when the sole requested symbol is `createCdpFacilitatorClient`.

Representative reproducible errors:

```text
Could not resolve "@x402/svm/exact/client"
Could not resolve "@x402/svm/exact/v1/client"
Could not resolve "@x402/svm/upto/client"
Could not resolve "@x402/svm/exact/server"
Could not resolve "@x402/svm/upto/server"
Could not resolve "@x402/extensions/builder-code"
Could not resolve "@x402/extensions/bazaar"
Failed to build Functions at ./functions.
```

The runner creates and bundles an import-only Pages probe every run, so this failure is independently tested from the successful Foundation fixture. No unresolved imports were marked external or hidden with shims. No private SDK subpaths were used.

Smallest feasible next choices, **not implemented**:

1. Evaluate installing the SDK's missing optional peers, keeping registration exclusively Base Mainnet. This may solve packaging, but adds unrelated-chain code/dependencies and still needs actual Pages bundling/runtime verification.
2. Request an upstream facilitator-only public export without the broad barrel imports.
3. Evaluate the published `@coinbase/x402` 2.1.0 `createFacilitatorConfig` wrapper, or a narrow explicit adapter using public `@coinbase/cdp-sdk/auth` and Foundation HTTP client. This preserves CDP/native Fetch/Base but needs a separate reviewed proof. The older wrapper was inspected during research and is not retained as a dependency.

No provider, framework, scheme, network, or hosting target was substituted to conceal this blocker.

## Credentials, cryptography, flags and limits of proof

Production CDP uses `https://api.cdp.coinbase.com/platform/v2/x402`, with `/supported`, `/verify`, `/settle`. The recommended helper requires a CDP API key ID and secret, generating per-operation JWTs bound to method/host/path. Store any future credentials in server-side Cloudflare bindings, never Vite/browser variables. The inspected helper does not require a wallet secret merely to authenticate the facilitator. Account permissions, IP restrictions, current entitlement and live authentication remain unverified.

Installed auth code uses jose, uncrypto random values, Web Crypto and Buffer (including Ed25519 key decoding). Narrow `/auth` import and missing-input validation execute in Pages; Web Crypto SHA-256 succeeds. **JWT signing, key import, and live CDP authentication were not exercised.** No credentials or keys were requested, read, generated, printed or committed. Import success and a credential guard do not establish signing compatibility. No flags were added; the current date enables Node compatibility implicitly, so this is not evidence for older/no-Node-compat isolates.

## Security and free-tier unknowns

- Final `npm audit` reports **5 high-severity affected packages**, rooted in Zod 3.25.76: `zod`, `abitype`, `@x402/core`, `@x402/evm`, `@coinbase/cdp-sdk`. [GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) concerns memory exhaustion while validating oversized constrained collections. Audit offered incompatible version changes, so no forced downgrade or unverified override was applied. Resolve advisories and set input limits before exposing payment parsing publicly.
- Local execution needs no paid API or account. CDP documentation currently describes 1,000 onchain transactions/month free, then $0.001 each, and free verification. This is not an unlimited free-production guarantee; account eligibility and billing controls need owner verification.
- Cloudflare free limits currently include 100,000 requests/day, 10 ms CPU/request, 128 MB memory, and 50 subrequests/request. This spike does not measure CPU, cold-start budget, JWT signing cost, production bundle limits, provider latency, rate limits or sustained load. Local success does not prove free-tier production viability.
- Real payment signature validation, USDC execution, merchant funds routing, replay/idempotency, settlement timeouts/reconciliation and delivery after confirmed payment are unproven. No application payment flow was implemented.
- No blockchain transactions, contracts, live settlement calls, real payment authorization submissions, deployment, DNS changes or spending occurred. External access was limited to research/package tooling, not payment execution.

## Owner review and next smallest task

SG-02A ends here. Review the dependency/import blocker and advisory before selecting one bounded follow-up packaging approach. An authenticated CDP experiment would additionally require owner-provisioned credentials and explicit permission for the specific external action; a live settlement/payment remains outside this task. No such approval is needed to reproduce the present local tests. Do not start the next phase automatically.
