# SG-07 payment implementation continuation — 6af7855

**Verdict: BLOCKED. SG-07 remains IN PROGRESS. Public payments and real upstream fulfillment remain disabled.** Owner priority is x402 payments before Builder Code or grant submission; no Builder Code/grant work was performed. This continuation hardens the safe local implementation and identifies concrete approval boundaries. It does not claim the implementation is ready for a real payment.

## Baseline and authority

Read-only inspection confirmed `main` at **6af7855**; only the twelve preserved review archives were initially untracked. No applicable AGENTS.md or canonical V2 project documents were available locally; supplied requirements govern. Existing SG-07 remediation/release/settlement/upstream/registry reports, payment modules, seven migrations, public router and CI were inspected. Owner reports operational Pages/D1, deployed/runtime-verified registry, and successful Alchemy registry observation. These control-plane observations do not establish individual finalized resource registration, trusted admission, CDP settlement, or safe merchant upstream connections. No live RPC, facilitator, upstream, production API, secret, Cloudflare or D1 operation was used in this task.

## Actual local defects corrected

| Defect                                                                                                                  | Correction                                                                                                                                                                            | Security limit                                                                                                          |
| ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- |
| Local reconciliation matched chain/token/payer/nonce identity but omitted the exact authorization/signature fingerprint | `LocalEvidence` must also match the attempt's persisted `authorization_fingerprint`; the deterministic local ledger emits the independently canonicalized fingerprint                 | This remains local simulation evidence, not production admission                                                        |
| Reconciliation relied on its caller to time-bound the lookup                                                            | `reconcileUnknown` itself wraps lookup in the existing one-second hard deadline                                                                                                       | A lookup timeout leaves the attempt unknown; no settlement retry or receipt                                             |
| Receipt settlement CAS matched attempt ID and authorization key but did not compare the entire supplied snapshot        | CAS now matches fingerprint, merchant/resource, price, payee/payer/asset/network, revision/generation, registry version/hash, snapshot/request/URL hashes and exact requirements JSON | Protects against internally stale or wrongly supplied snapshots; does not manufacture external settlement proof         |
| Generic local advance/recovery could operate on another evidence realm                                                  | Every local advance/recovery update now explicitly requires `evidence_kind='local_simulation'`                                                                                        | Future production recovery needs its own reviewed authority; legacy/production rows cannot be repaired by the simulator |
| The facilitator adapter shared mutable protocol objects with an injected SDK client                                     | Deep-freeze bounded server requirements and payment payload before verification/settlement                                                                                            | Mutation attempts fail before submission or remain unknown after claim; D1 CAS still owns durable concurrency           |

No migration, dependency, deployment configuration, authentication, frontend, registry-contract or public routing change was necessary. Existing atomic phase/receipt/analytics batches, replay indexes, ambiguous settlement states, paid-but-unfulfilled receipts and production denial remain intact. No automatic refund, retry-charge, reconciliation status endpoint or new trusted-evidence source was invented.

## Dependency and official compatibility review

Current full audit: **17 affected entries (5 high, 12 moderate)**; production-only: **5 high**. Audit JSONs remain visible in ignored `.wrangler/payment-completion-audit*.json`. There are two advisory roots, propagated through dependants: Zod GHSA-mrhx-c7xc-m3w5 and minimatch GHSA-g3hv-75wg-m249.

Fresh public npm metadata still reports:

- [CDP SDK 1.60.0](https://registry.npmjs.org/@coinbase/cdp-sdk/1.60.0): Zod `^3.25.76`, abitype 1.0.6, Kit `^5.5.1`, x402 peers `^2.25.0`. Current stable CDP is still 1.60.0; no newly supported patched combination was found.
- Installed core/EVM/extensions 2.29.0 and SVM 2.28.0 remain. [SVM 2.29.0](https://registry.npmjs.org/@x402/svm/2.29.0) requires Kit `>=8.0.0`, incompatible with CDP's Kit/program dependency line. Root Zod 3.25.76 and nested SVM/core Zod-3 paths remain affected. Root Foundation core's patched Zod-4 line does not fix those paths.
- The alternate official [@coinbase/x402 2.1.0](https://registry.npmjs.org/@coinbase/x402/2.1.0) also depends on CDP SDK and Zod `^3.24.2`; it is not a clean compatible remediation.
- Latest [config-array 0.23.5](https://registry.npmjs.org/@eslint/config-array/0.23.5) and [typescript-estree 8.72.1](https://registry.npmjs.org/@typescript-eslint/typescript-estree/8.72.1) still constrain minimatch 10; patched minimatch 11 is outside their supported dependency ranges.

Dependencies and lockfile are unchanged. No audit-force fix, override, peer bypass, suppression, unsupported downgrade, SDK/provider removal or cosmetic dev-dependency reclassification was performed. Owner priority does not resolve these incompatible upstream requirements. The smallest supported path remains upstream fixes; any substantially different SDK/authentication boundary needs a separate reviewed design, compatibility and security evidence. Installed vulnerabilities remain blockers even though the public browser/Functions graph excludes their code.

Installed public `@coinbase/cdp-sdk/x402` returns official `HTTPFacilitatorClient`, and current adapter is typed against its `verify`/`settle` methods. SDK source builds supported/verify/settle JWT paths. The generated x402 APIs expose those methods and discovery, not an authoritative authorization-status lookup in the interface used here. General CDP/payment-API idempotency documentation cannot be assumed to apply to this x402 method. [Coinbase's x402 flow](https://docs.cdp.coinbase.com/api-reference/v2/rest-api/x402-facilitator/bazaar-mcp-server) describes verify followed by settle; it is not a durable reconciliation contract. No live authenticated interface or retry guarantee is certified by this review.

## Payment implementation and remaining integration work

The existing isolated gateway still executes genuine protocol v2 402 requirements → locally signed EIP-3009 authorization → D1 unique claim → facilitator verification → configuration/registry rechecks → durable pending CAS → one simulated settlement → atomic local receipt/event → bounded JSON fulfillment. Canonical Base network, native USDC, exact atomic amount and server-owned payout are enforced. Tests run in real local workerd/D1 and exercise concurrent requests, process termination/reload, replay across merchants/resources, D1 faults, uncertain settlement, stale/disabled configurations and failed delivery. All successes remain LOCAL SIMULATION ONLY.

The independent observer verifies the conservative direct-USDC transaction subset, signature/fingerprint, exact payer/payee/token/amount, receipt/events, consumed nonce, finalized/canonical blocks and rechecks. Its result remains **rpc_observation_only**, and migration 0007 journals local review observations without changing attempt states or creating production receipts. A facilitator boolean, transaction hash, owner-reported live registry observation or D1 flag cannot bypass those boundaries.

Production orchestration is not complete. Required engineering/policy still includes:

1. **Resource admission authority.** Approve actual per-resource original/current owner, registry address/code, UUID-derived ID, salted commitment, exact price/payee/version, enabled state, finalized checkpoint/freshness and conflict-resolution policy. Migration 0004 deliberately blocks `onchain_confirmed`; any future writer requires a reviewed forward migration and server-only authority, preserving quarantine/history/revisions. Merely observing the deployed contract successfully cannot authorize paid resource configuration.
2. **Settlement evidence admission.** Specify the approved provider/finality/clock policy and immutable evidence persistence linking the exact authorization and admitted resource snapshot to its receipt. The production-facing component must distinguish genuine provider evidence from local transports; current review-only journals intentionally cannot promote a mock.
3. **Unknown outcomes.** A response lost before a hash is recorded requires approved authoritative nonce/event reconciliation or operator evidence review. The installed facilitator helper provides no such lookup here. Do not auto-resubmit. Persist unknown until trustworthy evidence resolves it. Any nonce-log indexing/backfill range, checkpoint/retention/billing policy and conflict handling need approval and implementation.
4. **Actual execution shape.** The observer currently rejects router/multicall transactions. Genuine CDP exact-EVM calldata/receipt shape must be established with approved evidence before relying on this observer in production; do not broaden it to trust arbitrary logs/hashes.
5. **Recovery/delivery policy.** Define authenticated operator/buyer recovery, retention and incident handling for paid-but-unfulfilled requests. Preserved settlement evidence cannot be erased or relabelled unpaid. No second charge is allowed. A D1 release claim does not prove client receipt, and D1/facilitator/upstream cannot form one atomic transaction.
6. **Runtime operations.** Approve clock/skew/finality assumptions, primary/session consistency, D1 backup/restore, admission concurrency, abuse limits, monitoring/redaction and fail-closed operational controls. Platform/free-tier quotas are not anti-abuse guarantees.

These are necessary integration/security tasks after policy review, not merely credentials to paste into an otherwise finished gateway.

## SSRF decision boundary — approval required

Current production transport continues to deny every merchant upstream URL. It denies known-ineligible resources before a new payable challenge or settlement. Existing JSON/method/header/body/redirect/deadline/cache and post-settlement delivery protections remain. No unrestricted fetch wrapper or dummy handler was substituted for the merchant API.

Current official [Workers Request docs](https://developers.cloudflare.com/workers/runtime-apis/request/) constrain resolveOverride to zone-based hostname overrides, not a general peer-IP pin for arbitrary HTTPS fetches. A separate DNS lookup/allowlist does not establish the socket destination. [Workers TCP socket docs](https://developers.cloudflare.com/workers/runtime-apis/tcp-sockets/) expose optional remoteAddress, explicitly block Cloudflare destinations and describe address/port restrictions directing HTTP 80/443 use to Fetch. A custom socket/HTTP/TLS parser is therefore not an evidenced transparent solution for the existing arbitrary merchant-HTTPS product. It was not introduced just to mark this gate passed.

Concrete choices requiring owner/ChatGPT review:

| Choice                                                                 | Concrete boundary                                                                                                                                                                                                                                                                                                              | Product/approval consequence                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Preserve arbitrary merchant HTTPS APIs                                 | Approve and prove a connection-constrained egress architecture with TLS/host/peer-IP enforcement, full DNS/CNAME/IPv6/private/reserved rejection, redirect denial, bounds/cancellation, concurrency and failure policy                                                                                                         | Additional architecture/infrastructure work is required. No new service/provider/cost is authorized here                                                                                             |
| Narrow the first supported resources to fixed service-binding handlers | Server-owned manifest binds exact merchant/resource/config commitment/version to a named binding and fixed handler route. Handler accepts no arbitrary target and performs no generic fetch. Fresh GET carries Accept only, with existing JSON/deadline/cache bounds and eligibility rechecks before challenge/charge/delivery | Changes supported resource onboarding/product scope and requires local implementation/review plus separately approved binding infrastructure. Not silently interchangeable with arbitrary HTTPS APIs |

Recommendation for decision: first choose whether arbitrary merchant-HTTPS support must remain in the initial payment validation scope. If yes, authorize a concrete egress design before implementation. If a restricted fixed-handler pilot is acceptable, explicitly approve that scope and manifest/handler security contract. Neither alternative is currently enabled or proven production safe. An owner-controlled hostname alone still does not provide the absent connection guarantee.

## One real Base Mainnet payment — non-executing prerequisites

Only after all mandatory gates pass and separate immediate approval:

- Owner approves dependency remediation or an independently reviewed supported SDK boundary; no accepted-risk label is silently substituted for a fix.
- Owner supplies genuine resource registration and canonical admission evidence for exact UUID/owner/payout/atomic price/version/hash, approved RPC/finality source and no pending ownership transfer/quarantine.
- Approve the upstream architecture and exact resource/handler/manifest; complete its security tests and recovery policy.
- Review production gateway/admission/reconciliation integration and approved schema/migration digests, backups and rollout. Migration 0007 has not been applied remotely by this task.
- Approve server-only CDP permissions/credentials through the owner's secret workflow, provider costs/limits, deploying/publication actions and rollback. No secret values should enter review documents or frontend code.
- Approve buyer/merchant addresses, **exact atomic USDC amount**, maximum USDC total, maximum ETH/all-fee/CDP spend, exactly one attempt and time window. No amounts/balances/prices are guessed here.
- Authorize the unpaid 402 check, informed buyer signing and one settlement explicitly. Collect independent canonical receipt/events/nonce-consumption evidence and matching durable D1 records before protected response release. On unknown outcome, mismatch or delivery failure, close exposure and reconcile without charging again.

A live test is not authorized by the local suite. Cryptographic regressions use the existing isolated, unfunded typed-data/SIWE test fixtures; no production wallet, blockchain transaction signing/broadcast, paid facilitator call, deployment or external infrastructure mutation was used.

## Changed files

- `server/sg05/reconcile.ts`
- `server/sg05/store.ts`
- `server/sg07/facilitator.ts`
- `tests/sg05/handler.ts`
- `tests/sg05/run.mjs`
- `tests/sg07/handler.ts`
- `tests/sg07/run.mjs`
- `docs/SG-07_PAYMENT_COMPLETION_REPORT.md`
- `docs/SG-07_REMEDIATION_REPORT.md`
- `docs/RELEASE_CHECKLIST.md`

## Verification

| Command                                                                                   | Actual exit/result                                                                                                                                            |
| ----------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run build`                                                                           | 0; TypeScript/Vite                                                                                                                                            |
| `npm run lint`                                                                            | 0                                                                                                                                                             |
| `npm run format:check`                                                                    | 0                                                                                                                                                             |
| `npm run test:sg05`                                                                       | 0; 132 targeted checks before the final additional recovery-isolation case; final aggregate runs 133                                                          |
| `npm run test:sg07`                                                                       | 0; 75 checks                                                                                                                                                  |
| `npm test`                                                                                | 0; **424** checks = 17 foundation + 14 compatibility + 14 SG-03 + 133 SG-05 + 20 SG-06 + 75 SG-07 + 43 registry admission + 32 upstream + 76 release security |
| `npm run build:functions`                                                                 | 0                                                                                                                                                             |
| `npm run check:bundle-boundary`                                                           | 0; 463 Functions / 1,781 browser inputs; payment/test SDK/Zod/minimatch remain excluded                                                                       |
| `npm audit` / full audit JSON                                                             | 1; 5 high + 12 moderate                                                                                                                                       |
| `npm audit --omit=dev` / production audit JSON                                            | 1; 5 high                                                                                                                                                     |
| `npm ls zod minimatch @coinbase/cdp-sdk @x402/core @x402/evm @x402/svm @solana/kit --all` | 0; supported installed peer tree unchanged                                                                                                                    |
| `forge fmt --check`, `forge build`, `forge test -vvv`                                     | 0; 47 passed, 0 failed/skipped; no contract/compiler changes                                                                                                  |
| `git diff --check`                                                                        | 0                                                                                                                                                             |

All nine aggregate suites actually ran against the final source. The 14 added groups are eight forged-snapshot cases, one hung-lookup case, one fingerprint rejection, one recovery-realm case and three adapter mutation cases. Existing local-only opt-ins, loopback guards, egress interception, production route exclusion and archive preservation remain. Test fixture fingerprints use canonical object ordering independently from the server implementation; no assertions were weakened. Logs are ignored `.wrangler/payment-completion-*` local artifacts. There was no live settlement, RPC/upstream egress, production key use, remote migration or Git mutation.

**Stop for owner/ChatGPT decision.** A supported dependency path, upstream scope/transport choice and reviewed production evidence/recovery authority must be resolved before the remaining production integration can be safely completed. This task does not certify that only a live payment test remains.
