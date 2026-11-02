# SG-07 dependency security audit and compatible remediation

**SG-07 IN PROGRESS. Production launch BLOCKED.** This is a local dependency and bundle assessment, not a security certification or launch authorization. No compatible dependency change was justified by the current upstream metadata. Public payment fulfillment and real upstream transport remain disabled.

## Baseline and scope

On 2026-11-02, read-only inspection confirmed branch `main`, HEAD `d1566c0`, matching the owner-approved baseline. The initial tree contained only ten untracked review archives; all were preserved. No applicable AGENTS.md or canonical V2 rules/roadmap files were found locally; the supplied restrictions govern. Existing registry admission, persistent conflict quarantine, upstream controls, migrations and completed-phase behavior were preserved.

Reviewed package manifests/lockfile, installed dependency declarations, CI, public Functions imports, wallet/authentication/resource/reporting code and SG-07 security reports. Environment: Node 22.22.2, npm 10.9.7, Wrangler 4.154.0, Vite 8.3.5, Forge 1.5.1-stable. No system tooling was installed.

## Fresh audit inventory

Both text and JSON variants were executed. Each audit exited **1**:

| Command                                                | Current findings                                             |
| ------------------------------------------------------ | ------------------------------------------------------------ |
| `npm audit` / `npm audit --json`                       | 17 affected entries: 5 high, 12 moderate; no low or critical |
| `npm audit --omit=dev` / `npm audit --omit=dev --json` | 5 high; no moderate, low or critical                         |

These are **two root advisories**, propagated through dependency relationships, rather than seventeen independent vulnerabilities.

| Root advisory                                                                      | Vulnerable installed version | Published affected/fixed range     | Affected entries                                  |
| ---------------------------------------------------------------------------------- | ---------------------------- | ---------------------------------- | ------------------------------------------------- |
| [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5)       | Zod 3.25.76                  | Affected `<4.6.6`; fixed `4.6.6`   | Zod, CDP, abitype, nested x402 core, SVM: 5 high  |
| [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249) | minimatch 10.2.6             | Affected `<11.0.1`; fixed `11.0.1` | minimatch plus 11 tooling dependants: 12 moderate |

Zod's issue concerns memory amplification while constructing errors for oversized failing arrays. minimatch's issue concerns glob preprocessing amplification with `optimizationLevel >= 2`. Input bounds are defense in depth and do not remediate either installed advisory.

Complete affected-entry inventory:

- High: `@coinbase/cdp-sdk@1.60.0`, `@x402/svm@2.28.0`, its nested `@x402/core@2.28.0`, `abitype@1.0.6`, `zod@3.25.76`.
- Moderate: `minimatch@10.2.6`, `eslint@10.13.0`, `@eslint/config-array@0.23.5`, `@eslint/js@10.0.1`, `@eslint-community/eslint-utils@4.10.1`, `eslint-plugin-react-refresh@0.5.7`, and `typescript-eslint`, `@typescript-eslint/eslint-plugin`, `parser`, `type-utils`, `typescript-estree`, `utils`, all at 8.72.1.

## Dependency paths and supported compatibility

`npm ls zod minimatch @coinbase/cdp-sdk @x402/core @x402/evm @x402/extensions @x402/svm @solana/kit --all` and `npm explain zod` / `npm explain minimatch` exited 0. Public npm metadata was checked with `npm view <package> version dependencies peerDependencies peerDependenciesMeta engines dist.integrity --json`, including explicit installed/candidate versions.

| Dependency path / candidate                                                          | Verified upstream constraints                                                                                                                                  | Conclusion                                                                                                           |
| ------------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| Root → CDP 1.60.0 → Zod                                                              | CDP still latest 1.60.0; requires `zod ^3.25.76`                                                                                                               | Latest stable Zod 3 is 3.25.76; no patched release satisfying this range found                                       |
| CDP → abitype 1.0.6 → optional Zod peer                                              | CDP pins abitype exactly 1.0.6; abitype accepts Zod `^3 >=3.22.0`                                                                                              | Patched Zod 4 cannot satisfy this declaration                                                                        |
| Root → SVM 2.28.0 → core ~2.28.0 → Zod                                               | Nested core resolves vulnerable root Zod 3                                                                                                                     | Upgrading only root core does not replace this nested core                                                           |
| Root core / EVM / extensions 2.29.0                                                  | Require Zod `^4.6.6`; each resolves 4.6.7                                                                                                                      | Already patched for this advisory; do not confuse these with nested core 2.28.0                                      |
| SVM 2.29.0 candidate                                                                 | Peer `@solana/kit >=8`; installed SVM 2.28 accepts `>=5.1.0`                                                                                                   | Conflicts with CDP's Kit `^5.5.1` integration and token/system program peers `^5.0`; no forced Kit upgrade           |
| Latest abitype 1.3.0                                                                 | Supports Zod 3 or 4                                                                                                                                            | Does not satisfy CDP's exact 1.0.6 pin; modern optional peers elsewhere do not eliminate CDP's direct vulnerable Zod |
| ESLint → config-array → minimatch; typescript-eslint → typescript-estree → minimatch | Installed parents require minimatch 10; latest ESLint 10.14.0 still `^10.2.6`, latest config-array 0.23.5 `^10.2.4`, latest typescript-estree 8.72.1 `^10.2.2` | Patched minimatch 11 is outside supported parent ranges                                                              |

Official manifests supporting these decisions: [CDP 1.60.0](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0), [abitype 1.0.6](https://registry.npmjs.org/abitype/1.0.6), [SVM 2.28.0](https://registry.npmjs.org/@x402/svm/2.28.0), [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0), [core 2.29.0](https://registry.npmjs.org/@x402/core/2.29.0), [ESLint 10.14.0](https://registry.npmjs.org/eslint/10.14.0), [config-array 0.23.5](https://registry.npmjs.org/@eslint/config-array/0.23.5), [typescript-estree 8.72.1](https://registry.npmjs.org/@typescript-eslint/typescript-estree/8.72.1), [Zod versions](https://registry.npmjs.org/zod), [minimatch 11.0.1](https://registry.npmjs.org/minimatch/11.0.1).

CDP declares optional x402 SVM/extensions peers; the existing public x402 entry-point compatibility fixture requires these packages to resolve its imports. Removing them or replacing the CDP entry point would change the previously tested integration and is not an authorized remediation. npm's suggested CDP/ESLint/TypeScript-eslint downgrades and SVM upgrade are not evidence of a supported secure combined graph. No downgrade, override, forced peer install, SDK removal or architecture substitution was applied. A newer viem patch alone would not remove CDP's direct Zod dependency.

**Final versions unchanged:** CDP 1.60.0; core/EVM/extensions 2.29.0; SVM and its core 2.28.0; Solana Kit 5.5.1; root Zod 3.25.76 plus three patched Zod 4.6.7 installations; minimatch 10.2.6; ESLint 10.13.0; typescript-eslint 8.72.1; viem 2.57.13. `package.json` and `package-lock.json` are unchanged.

## Actual bundle and input reachability

Auditing installed dependencies does not establish exploitation through a public route. Conversely, absent current imports do not remediate an installed vulnerability or approve future SDK exposure.

| Surface                                  | Actual analysis                                                                                                                                                                        | Exposure conclusion                                                                                                                                                                                                                                                                                             |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Deployable Pages Functions               | Wrangler production metafile: no Zod, minimatch, CDP, x402, SG-05 or SG-07 modules. Parsed abitype inputs contributed zero output bytes                                                | No vulnerable Zod or minimatch code emitted into this current API artifact                                                                                                                                                                                                                                      |
| Browser                                  | Actual configured Vite production build, `write:false`, Rollup-compatible graph hook: 1,780 module graph entries; no Zod, minimatch, CDP or x402 inputs in the graph or emitted chunks | Current wallet/UI graph does not ship these vulnerable packages. viem/ox ABI utilities are not equivalent to importing `abitype/zod`                                                                                                                                                                            |
| SG-03 auth/resources and SG-06 reporting | Source and API graph inspection: viem SIWE/recovery and address utilities, bounded manual validation and prepared D1 queries                                                           | No Zod parser path from these public handlers found                                                                                                                                                                                                                                                             |
| SG-05 and SG-07 isolated fixture bundles | Wrangler metafiles with the configured compatibility date: root Zod 3 parsed inputs emit **0 bytes** in both; patched Zod 4 contributes 872,418 / 872,529 bytes respectively           | These specific local fixture outputs use patched Foundation Zod parsing; installed vulnerable Zod is tree-shaken here. Not a guarantee for other SDK methods or future builds                                                                                                                                   |
| CDP facilitator boundary                 | SG-07 imports the official client type only and injects verify/settle capability; SDK policy schemas import both `zod` and `abitype/zod`                                               | Installed SDK has real vulnerable schema dependencies. Type-only use and today's tree shaking do not prove all CDP APIs safe or certify live authenticated settlement                                                                                                                                           |
| ESLint / TypeScript tooling              | minimatch is used for file/config pattern processing, outside browser/Functions output                                                                                                 | Development/CI dependency risk remains. Inspected ESLint/config-array options use `{ dot: true }`, without optimization level 2; minimatch defaults to level 1. The advisory's vulnerable mode was not demonstrated reachable from this repository's lint invocation; no blanket exploitability or safety claim |

The public router continues to exclude the local simulated gateway and registry/upstream fixtures. Bounded payment parsing and local mock-only execution remain intact. No CDP credentials were introduced, read for use, or embedded by this work. Public payments and actual merchant upstream connections remain denied. No raw authorization payload or secret was printed. No denial-of-service payload was executed to exhaust the host.

### Reproducing the graph evidence

Local raw artifacts are ignored under `.wrangler/dependency-exposure/`; they are diagnostic output, not committed release artifacts. The production Functions graph is reproducible with:

```bash
node node_modules/wrangler/bin/wrangler.js pages functions build \
  --outdir .wrangler/dependency-exposure/api/out \
  --metafile .wrangler/dependency-exposure/api/meta.json
```

For the isolated fixture graphs, create an ignored temporary `functions/probe.ts` that re-exports the existing `onRequest` from `tests/sg05/handler.ts` or `tests/sg07/handler.ts` using its absolute path, then run the same command with that functions directory and **`--compatibility-date 2026-10-28`**, matching Wrangler configuration/test harnesses. Inspect each metafile's `inputs` and each output's `inputs[path].bytesInOutput`, separating root `node_modules/zod` from nested `@x402/core/node_modules/zod`. A module listed as an input with zero output bytes is not emitted vulnerable code.

For the browser, invoke Vite's `build` API with the existing project configuration and `build: { write: false }`; add a diagnostic plugin's `generateBundle` hook to capture `[...this.getModuleIds()]`, `this.getModuleInfo(id)` and each emitted chunk's `modules`. Search paths for `/zod/`, `/minimatch/`, `/@coinbase/cdp-sdk/` and `/@x402/`, including dynamic chunks. No application or Vite configuration edit is needed. This checks actual build composition rather than searching only minified identifier strings.

An initial ad hoc fixture graph command omitted the configured compatibility date and exited 1 with Node builtin resolution errors (`crypto`, `buffer`, etc.). Repeating it with the existing date succeeded for both fixtures, without adding `nodejs_compat` or changing application configuration. This setup failure is not concealed as a successful build and does not contradict the normal runtime tests.

## Verification results

All listed exit statuses below were observed locally. The individual application suites ran as the actual `npm run test:*` subprocesses of `npm test`; they were not replaced with Node-only mock assertions.

| Command                               | Exit | Actual result                                                                  |
| ------------------------------------- | ---- | ------------------------------------------------------------------------------ |
| `npm run build`                       | 0    | TypeScript and production Vite build pass                                      |
| `npm run lint`                        | 0    | ESLint passes                                                                  |
| `npm run format:check`                | 0    | Formatting passes, including this report                                       |
| `npm run test:foundation`             | 0    | 17 checks                                                                      |
| `npm run test:compatibility`          | 0    | 14 checks; actual CDP entry point bundles/loads                                |
| `npm run test:sg03`                   | 0    | 14 checks                                                                      |
| `npm run test:sg05`                   | 0    | 95 checks; local simulation only                                               |
| `npm run test:sg06`                   | 0    | 20 checks, including Chromium                                                  |
| `npm run test:sg07`                   | 0    | 45 checks                                                                      |
| `npm run test:registry-admission`     | 0    | 43 checks; durable conflict quarantine retained                                |
| `npm run test:upstream-security`      | 0    | 32 checks; policy tests, not live connection proof                             |
| `npm test`                            | 0    | **280 application checks** across all eight suites                             |
| `npm run build:functions`             | 0    | Deployable native Functions build passes                                       |
| `forge fmt --check`                   | 0    | From `contracts/`                                                              |
| `forge build`                         | 0    | Existing contract compiles; existing lint notes are not security certification |
| `forge test -vvv`                     | 0    | **47 passed**, 0 failed, 0 skipped                                             |
| `npm audit` / `npm audit --json`      | 1    | 5 high + 12 moderate                                                           |
| `npm audit --omit=dev` / JSON variant | 1    | 5 high                                                                         |
| `git diff --check`                    | 0    | No whitespace errors                                                           |
| `git status --short`                  | 0    | Four documentation changes plus the ten preserved review archives              |

A clean isolated temporary copy of the unchanged manifests also ran `npm ci --ignore-scripts --no-fund`: exit 0, 397 packages installed, same 17 findings. The temporary install was removed afterward. This demonstrates locked dependency resolution/installability without forcing peers; lifecycle scripts were intentionally not executed. It is not proof of a full remote CI run. The normal existing local installation ran all application tests above. No dependency modifications required new behavior tests.

Existing CI remains unchanged: read-only repository permissions, pinned actions/toolchain, build/lint/format/application/Foundry checks and a mandatory dependency audit job. Its audit gate remains failing; no continue-on-error or advisory suppression was added. Hosted CI itself was not invoked.

## Changed files and remaining decisions

Exactly four documentation files changed:

1. `docs/SG-07_DEPENDENCY_SECURITY_REPORT.md` — this current audit and exposure evidence.
2. `docs/SG-07_READINESS_REPORT.md` — dependency continuation evidence.
3. `docs/RELEASE_CHECKLIST.md` — unresolved release gate clarification.
4. `docs/SG-07_LAUNCH_RUNBOOK.md` — lockfile/artifact review requirement.

No application, test, contract, migration, CI, manifest or lockfile changes. No archives modified. No Git mutations, deployment, remote D1 operation, live RPC/CDP call, transaction, spending, secret provisioning or DNS change occurred.

**Recommendation: local assessment ready for owner review; production readiness BLOCKED.** Obtain supported upstream CDP/Zod and compatible SVM/Kit remediation and patched minimatch parent releases, or separately review any proposed SDK boundary/design change before implementation. No risk acceptance or provider change is inferred. Before deployment, re-audit the exact candidate lockfile and inspect the exact browser/Functions artifacts again; today's negative import evidence is not transferable to future imports. Registry deployment/admission authority, live facilitator verification, reconciliation, connection-safe upstream transport and the other existing launch gates remain independently blocked/unverified. SG-07 stays IN PROGRESS; no SG-08 work was begun.
