# SG-02B — CDP bundling, dependency security, local Git

Date: 2026-10-29 (Asia/Jakarta). Final recommendation: **OWNER DECISION REQUIRED** for the unresolved dependency security risk before any public payment release. **The SG-02A CDP packaging blocker is resolved, and local compatibility checks pass.** This report does not approve production payments or begin another phase.

## Initial state

Read the entire SG-02A report, manifest/lock, Wrangler configuration, health route, compatibility handler/runner/type configuration and .gitignore before editing. Searched for applicable AGENTS.md and roadmap/project instructions: none were available locally, beyond the template README and SG-02A report. `git status --short` confirmed there was no repository in this directory or its ancestors.

Before changes, build and lint passed. The existing compatibility command passed its 10 runtime checks and reproduced the expected CDP bundle failure. The error was unresolved imports from `@x402/svm` and `@x402/extensions` through the public `@coinbase/cdp-sdk/x402` barrel. Thus its prior overall exit 0 did not establish CDP compatibility.

Toolchain: Node 22.22.2, npm 10.9.7, TypeScript 5.9.3, Vite 8.3.5, Wrangler 4.154.0, workerd 1.20261023.1. Wrangler remains at compatibility date **2026-10-28**, with no explicit flags added. No application configuration or production function was changed.

## Official dependency solution

Installed and retained exactly:

```sh
npm install --save-exact @x402/svm@2.28.0 @x402/extensions@2.28.0
```

Existing `@coinbase/cdp-sdk@1.60.0`, `@x402/core@2.28.0` and `@x402/evm@2.28.0` remain pinned. CDP declares all four Foundation packages as optional peers at `^2.25.0`; the selected versions satisfy that range. SVM's `@solana/kit >=5.1.0` peer resolves to the already installed 5.5.1. No force, legacy-peer-deps, override, incompatible upgrade, private import, provider substitution or framework change was used.

The SVM dependency supplies modules needed by the bundler. **No SVM scheme, signer, RPC client or network was registered or invoked.** The resource server still registers only `eip155:8453` with `ExactEvmScheme`. The mock advertises only that same network. The runtime probe asserts the configured network list is exactly `['eip155:8453']`.

Evidence of installation cost:

| Measurement | Before | After | Change |
| --- | ---: | ---: | ---: |
| Lockfile package entries, including optional platform packages | 401 | 469 | +68 |
| package-lock.json bytes | 216,853 | 264,390 | +47,537 |
| Installed node_modules disk allocation (`du -sk`, KiB) | 561,680 | 624,308 | +62,628 KiB |
| Controlled fixture bundle, unminified JavaScript bytes | 308,882 | 374,070 | +65,188 |
| Same fixture bundle, gzip bytes | 62,727 | 68,836 | +6,109 |

The before/after bundle measurement used the same one-route native Pages wrapper importing `handleCompatibility`, `wrangler pages functions build --outdir`, and Node `gzipSync`. The change includes both CDP helper code and the new validation controls; it is not a measurement of dependency cost alone. There was no successful CDP bundle before this fix to compare directly. Disk allocation is local/platform-specific, not deployment size. Lockfile comparison found **zero changed existing versions and zero removed entries**.

The separate CDP probe bundle in the final test run was 374,260 raw JavaScript bytes, approximately 69,166 gzip bytes. Gzip can vary slightly with generated temporary paths. Production UI and health do not import these packages, so this fixture size is not the current application Functions bundle size. Free-tier CPU, cold-start and sustained load capacity remain unmeasured.

## CDP bundle and actual runtime result

The existing runner was extended, not replaced. Its formerly expected-failure probe now requires Wrangler exit **0**; any bundle error fails the test with the actual compiler output. A temporary native Pages probe imports `createCdpFacilitatorClient` from the public `/x402` entry point. The runner builds it explicitly, then includes it as `/probe` in the isolated Pages project and fetches it inside workerd.

The runtime check requires HTTP 200 and proves:

- The intended public CDP helper is a function after bundling/loading.
- Calling it with explicit empty credential arguments reaches its documented missing-credentials guard. Explicit empty arguments prevent environment fallback; no credentials are accessed or fabricated.
- Foundation/EVM modules, the existing CDP auth guard and Web Crypto SHA-256 still execute.
- The fixture is configured exclusively for Base Mainnet.

**This resolves module packaging and loading, not authenticated CDP execution.** JWT signing, private-key import, live authentication, live verify/settle and real USDC settlement remain unverified. No private-key material was generated to expand the proof.

## Preserved safety and bounded input mitigation

All original checks remain: production health, local guards, v2 USDC challenge, missing/malformed/mismatched authorization, mock verification rejection without settlement, positive mock verification without paid content, rejection-only settlement HTTP transport, and absence of fixture exposure from the normal app. Mismatched network and recipient checks were added.

Additional safeguards apply only to the existing isolated test handler:

| Bound | Limit and behavior |
| --- | --- |
| Request method | GET only; other methods return 405 without parsing body |
| Request URL | 2,048 characters; excess returns 414 |
| PAYMENT-SIGNATURE header | 8,192 characters before Base64 decoding; excess returns 413 |
| JSON nesting | 16 levels, checked with a string/escape-aware scan before JSON parsing |
| Collections | At most 32 elements or object entries each |
| Aggregate structure | At most 256 visited values |
| Strings / keys | 2,048 / 128 characters |

Collection checks run after bounded JSON decoding but **before Zod/SDK schema parsing**. Oversized structures return 413. Tests cover header, nesting, array/object size, string length, aggregate nodes, method and URL limits, and assert the mock receives no additional calls for these requests. These are deliberately conservative fixture limits, not finalized product limits.

The test-only fetch guard is still restricted to the serial isolated fixture. A new runtime test verifies it rejects a non-mock target before transport. Only the loopback mock origin and supported/verify/settle paths are allowed; redirects are rejected. No interception was added to production code. The fixture also requires its local binding, loopback request hostname and loopback Pages URL. Production `functions/` still contains only `api/health.ts`.

No paid content exists. A positive mock verify still returns 402 and no PAYMENT-RESPONSE. The settlement mock returns `success: false`, an empty transaction field and `local_mock_rejection`; the runner checks the rejection response. Protocol envelopes carry `{ localOnly: true }`, without any payment signature or authorization.

## Security findings: unresolved

[GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) lists versions below **4.6.6** as affected by memory exhaustion during collection validation. Installed Zod is **3.25.76**. Registry checks found latest Zod **4.6.7**, but the last published 3.x is still 3.25.76. The latest compatible SDK releases inspected still require Zod 3: core/EVM/extensions use `^3.24.2`, CDP uses `^3.25.76`. There is **no identified upstream-compatible fixed upgrade** in these dependency ranges. A major override would violate those ranges and was not attempted.

`npm audit` before installation: **5 high**, exit 1. After installation: **7 high**, exit 1. `npm audit --omit=dev --json` also reports **7 high**. The affected package records are Zod 3.25.76, abitype 1.0.6, CDP 1.60.0, and core/EVM/extensions/SVM 2.28.0. The two added records are extensions and SVM propagating the existing Zod finding; the audit identifies one underlying advisory, not seven independent exploits. CDP, core, EVM and extensions depend directly on Zod; SVM inherits it via core. The installed ESLint toolchain also uses the same Zod version, but it is not the sole source of exposure.

Audit proposes incompatible SDK downgrades (including Foundation 0.0.1). Those would abandon the selected v2 integration, so they were not applied. No advisory was suppressed and no dependency security issue is claimed resolved.

Zod is in the production **dependency graph**, not just devDependencies. However, source inspection finds no payment SDK imports in `src/` or `functions/`, and the production Pages metafile contains only health and routing support, with no fixture/CDP/x402 input. Therefore the current public application code does not expose this payment parser. A future production payment route would change that assessment.

Before exposing payment parsing, obtain compatible upstream remediation and review all untrusted parsing paths. Carry over appropriately sized header/body, nesting and collection limits before schema validation; bound streamed bodies and facilitator responses; reject unsupported methods/content types; add request/concurrency limits with 429 responses and operational monitoring. Platform daily quotas alone are not abuse prevention. Provider and hosting rate-control availability/free-tier limits require verification. Fixture bounds reduce one attack surface, but do not prove Zod safe or replace a patch/security review.

## Commands and actual verification

Inspection/research commands were grouped as follows: `pwd`, `git status --short`, `rg --files --hidden` excluding dependencies/build/state, targeted `cat`/`sed`/`rg` of the report/configuration/tests/installed SDK, `find` for AGENTS.md, `node --version`, `npm --version`, `npm ls` (SDK/Zod/peer trees and `--depth=0`), `npm view` (latest versions/dependencies/peers, plus Zod 3 releases), `du -sk node_modules`, `wc -c package-lock.json`, and `sha256sum` of the preserved report/health/Wrangler files. These confirmed the initial blocker and versions described above. Short Node scripts captured source snapshots outside the project, measured temporary Pages bundles, compared lockfile versions, and summarized audit/metafile JSON; their temporary bundle directories were removed.

| Command/check | Result |
| --- | --- |
| Baseline `npm run build`, `npm run lint` | PASS |
| Baseline `npm run test:compatibility` | Original 10 checks pass; old CDP bundle failure reproduced |
| Exact peer installation command above | Exit 0, 68 packages added; security findings retained |
| Final `npm run build` | PASS, TypeScript + Vite |
| Final `npm run lint` | PASS |
| Final `npm run test:compatibility` | PASS, **14 checks**; CDP probe build/load succeeds |
| `npx wrangler pages functions build` | PASS; generated `_worker.bundle` removed afterward |
| `npx wrangler pages functions build --outdir .wrangler/sg02b-production-build --metafile .wrangler/sg02b-production-meta.json` | PASS; no payment/fixture imports in production inputs |
| `npm audit` and `npm audit --json` | Exit 1, 7 high after installation |
| `npm audit --omit=dev --json` | Exit 1, same 7 high |
| `git init -b main .` | Local empty repository initialized |
| `git symbolic-ref --short HEAD`, `git rev-list --all --count` | `main`, zero commits |
| `git ls-files --stage`, `git remote -v` | Empty index, no remotes |
| `git check-ignore` for build/state/env/key filenames | All selected sensitive/generated examples ignored; no files created for these checks |
| `git status --short --untracked-files=all` / `--ignored` | Project sources untracked; dependencies/build/state ignored |

The compatibility command orchestrates real `node node_modules/wrangler/bin/wrangler.js pages dev` processes: isolated project with `assets`, and the unchanged normal project with `dist`, both bound to 127.0.0.1 on free ephemeral ports. Inspector ports are also selected dynamically. It supplies only local fixture bindings and disables Wrangler metrics. It stops only its own process groups.

Normal-project smoke result: GET `/api/health` **HTTP 200**, `Cache-Control: no-store`, exact JSON:

```json
{"status":"ok","service":"SignalArc Gate","network":"base-mainnet","chainId":8453}
```

Final mock traffic is 9 GET `/supported`, 2 POST `/verify`, 1 POST `/settle`, all loopback. No live facilitator operation or real payment authorization was submitted.

## Git and first-commit review

Initialized `.git/` in this directory only, branch `main`. No staging, commits, remotes, pushes or publishing occurred. This establishes repository metadata; there is **no committed baseline yet**. All project source/configuration/docs remain untracked until the owner selects files for a first commit.

Added ignore rules for `.wrangler/`, `_worker.bundle`, `.env`/`.env.*`, `.dev.vars` variants, common key/certificate containers, credential/secret JSON filenames and directories, and keystore files. Existing node_modules/dist/log ignores remain. Ignore rules were tested using path arguments without creating sensitive example files.

Before a first commit, the owner should review the manifest/lockfile, both reports, test-only local fixtures, and existing source/assets/README. Include the lockfile for reproducibility. Ensure any future unusually named credentials are excluded too; ignore patterns are not a secret scanner. Empty preexisting directories will not be tracked without files; no placeholder files were added to force tracking.

## Files changed and preservation

- Modified: `.gitignore`, `package.json`, `package-lock.json`, `tests/compatibility/handler.ts`, `tests/compatibility/run.mjs`.
- Created: `docs/SG-02B_REPORT.md`, local `.git/` metadata.
- Generated verification artifacts: normal `dist/` and ignored `.wrangler/` state/build/metafile. Temporary fixture/probe directories were cleaned up. No source files were deleted.
- Preserved: SG-02A report, health function, Wrangler/Vite/application configuration, React application, compatibility TypeScript configuration.

Before/after SHA-256 checks match for the SG-02A report (`2a492222982d03495c26edaf08c9c3e7db13f080d9ac7f05c3ceff820951ec09`), health function (`3967a0d50c37a0543df99edaa426ac10770d60b97f6f31a241a7a09b76802b87`) and Wrangler configuration (`1c97dee09ec2a00f0fd880f37ab75548a4ff1908aa5293f6978f066bfb683bf8`). The historical BLOCKED verdict in SG-02A is intentionally unchanged.

## Official sources consulted

- [Coinbase CDP existing-server configuration](https://docs.cdp.coinbase.com/x402/seller/production-configuration): public facilitator helper integration.
- [Coinbase SDK package declaration](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/package.json): supported entry points and optional peers; compared with exact installed 1.60.0 metadata.
- Foundation package declarations: [core](https://github.com/x402-foundation/x402/blob/main/typescript/packages/core/package.json), [EVM](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/evm/package.json), [SVM](https://github.com/x402-foundation/x402/blob/main/typescript/packages/mechanisms/svm/package.json), [extensions](https://github.com/x402-foundation/x402/blob/main/typescript/packages/extensions/package.json). Exact installed/registry 2.28.0 metadata governs this proof; repository main can change.
- [Cloudflare Pages local development](https://developers.cloudflare.com/pages/functions/local-development/), [Wrangler commands](https://developers.cloudflare.com/workers/wrangler/commands/), [Node compatibility](https://developers.cloudflare.com/workers/runtime-apis/nodejs/): native local runtime and bundling checks. Existing compatibility date enables Node support implicitly; no date/flag change was required.
- [GitHub-reviewed Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5): affected range and fixed version, cross-checked against npm audit/registry metadata.

## Remaining limits and next smallest task

The narrow SG-02B technical objective is achieved: the official peer solution builds and loads the public CDP helper in native local Pages, prior behavior is preserved, and local Git metadata is initialized. Production readiness remains unproven, particularly authenticated signing, settlement, replay/idempotency and free-tier performance. No transaction, public testnet, paid infrastructure, deployment, credential use or publication occurred.

Recommended next smallest task: owner/security review of this report and the residual Zod finding, followed by a separately scoped compatible-upstream-remediation review when available. Select and review the initial Git files separately; do not automatically commit or start SG-03. No external credentials or permissions are needed to rerun this local proof.
