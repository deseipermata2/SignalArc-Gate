# SG-07 x402 production activation implementation

**Verdict: BLOCKED for production activation; local implementation prepared for owner review. SG-07 remains IN PROGRESS.** No deployment, real CDP authentication/settlement, Mainnet RPC request, transaction, remote migration, Git mutation or phase completion was performed. Local simulations do not establish a real payment.

## Baseline and scope

Read-only inspection confirmed HEAD `e4317b7`, branch `wip/sg07-remediation-20261102`, initially clean tracked files and twelve untouched review archives. No applicable AGENTS.md or canonical V2 rules/roadmap files were found; the owner's supplied constraints govern. Historical reports retain their original evidence. Earlier statements that no deployable payment implementation exists are superseded by this report, not retroactively changed into successful live evidence.

The deployed registry pin remains Base 8453, `0xC4081a85935de1b9a929e5a6835d99471cd08c01`, runtime Keccak-256 `0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df`. Deployment/runtime matching and Alchemy observation are owner-reported prior evidence. Explorer source verification and resource registration are separate assertions; this task invents neither. No contract/compiler settings changed.

Only the existing owner-controlled resource-configuration JSON document is supported. Its pure serializer is shared with the existing local pilot. No merchant URL is fetched, no DNS lookup/proxy is introduced, and no buyer credential is forwarded to an upstream. The stored HTTPS URL remains a private configuration-commitment input. Arbitrary upstream transport remains denied.

## Implemented route and trust model

`GET /api/pay/<resource UUID>` is default disabled (HTTP 404). Buyers do not need merchant SIWE; merchant ownership instead comes from the operator manifest, existing D1 merchant/resource/binding relationship and independently read registry owner. Merchant CRUD cannot approve or replace manifests or write evidence.

When separately approved/enabled:

1. Require the exact production origin, Base chain, server-only credentials, primary D1 session and activation schema. Consume the existing global API budget. Reject simulated D1 for the production realm. No request header can select a transport, source realm, manifest, RPC URL or feature switch.
2. Resolve a non-revoked, unexpired, immutable manifest. Check merchant identity, original owner, owner-namespaced resource ID, payout, atomic amount, resource revision, binding generation, registry version and salted configuration commitment. Check persistent historical registry conflict/quarantine. The fixed JSON must fit the registered response bound.
3. Read finalized registry code and `CHAIN_ID()` using the deployed address/hash pin and EIP-1898 canonical block-hash references. Match exact finalized resource state and head state, require enabled/no pending transfer, then recheck canonical blocks and D1 identity. A D1 `source` string alone grants nothing. The existing observation/status API still does not approve payments.
4. Discover CDP Base v2 exact and Builder Code support. Persist an issued attempt and hashed ticket/request URL before the 402 challenge. Advertise only native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`, exact atomic price, authoritative payee, upfront EIP-3009 flow, 60-second challenge and `bc_ipzfx50y` declaration.
5. Bound/decode `PAYMENT-SIGNATURE`, require exact issued resource/requirements and valid Builder Code echo, and verify the EOA EIP-712 authorization locally before calling CDP. Contract-wallet signatures are not supported. No signed field, recipient, nonce or signature is rewritten. CDP receives separate copies of immutable inputs.
6. Claim the global authorization identity/fingerprint once in D1. Verify with CDP. Re-read finalized/current registry and D1 eligibility after verification. Enforce persisted verification/challenge deadlines; atomically claim settlement and recheck D1. Consume the one-use durable `submission_started_at` permit with a final D1 eligibility/lease CAS before calling settle. Its timestamp cannot be cleared. Concurrent workers/restarts cannot acquire it again.
7. Call CDP settle once. Persist its untrusted transaction report or unknown disposition. Transport errors, malformed replies, mismatches and ambiguous success remain unresolved. A provider boolean/hash never creates a receipt.
8. Independently verify the exact canonical successful transaction/receipt, direct native-USDC call, EIP-3009 signature/nonce/fingerprint/identity, payer/payee/amount, one matching Transfer and AuthorizationUsed event, consumed authorization state and finalized/canonical block identities. The existing strict observer rejects unsupported router/transaction shapes. This uses a separately configured read-only RPC, not CDP's report as authority.
9. Append a realm-labeled evidence checkpoint. Stable transaction/configuration identity is distinct from a normally advancing finalized anchor; prior anchors must remain canonical. Regressing observations cannot replace newer ones. Conflicts create permanent quarantine; replay/deletion cannot clear it. Atomically update the attempt, insert its unique immutable receipt and settlement analytics in one D1 batch. Any failure rolls back all three.
10. Return `202` while settlement is unresolved/not finalized, or `202 {paymentStatus:"settled_delivery_pending"}` after durable admission. **No protected content or PAYMENT-RESPONSE accompanies these statuses.** Retry the exact same issued URL and PAYMENT-SIGNATURE; never create/sign another authorization to resolve a pending attempt. Normal finality can take longer than an HTTP request or authorization validity; inclusion must have occurred during validity, but later proof/recovery is allowed.
11. A subsequent request claims delivery, rechecks the exact canonical receipt and current registry/manifest/D1 state, then completes a delivery-generation/deadline CAS before returning fixed JSON plus `PAYMENT-RESPONSE`. No shared caching; responses use private/no-store/no-referrer/nosniff. A stale worker cannot complete a newer delivery claim. A successfully fulfilled request is not delivered a second time.

Production requests have an explicit maximum of 38 read-RPC calls plus the bounded facilitator operations; settlement/admission and delivery use separate requests. This is not a free-tier capacity certification. D1 statement usage, CPU, provider quotas and abuse require owner review.

## Supported facilitator boundary and dependencies

The installed Foundation HTTP client follows redirects and provides no injected per-instance transport; forwarding a credential-bearing request across a redirect is inappropriate here. The production adapter uses **the officially documented CDP REST endpoints** with the **public `@coinbase/cdp-sdk/auth` generateJwt API**, native Fetch, fixed CDP host/path, `redirect: manual`, no retry, request-bound 60-second JWTs, eight-second deadline and bounded JSON. This retains Coinbase as facilitator. It does not use private SDK imports, wallet APIs, global fetch interception, Zod overrides or a substitute provider.

The actual public JWT helper executed in native workerd using a newly generated, ephemeral LOCAL authentication fixture; its EdDSA signature, request URI and TTL were verified. No real CDP key/account was used, no JWT/key was printed or persisted, and no authenticated CDP request was made. Existing Wrangler compatibility settings suffice for this local test; no compatibility flag or production configuration changed.

Installed versions remain CDP 1.60.0, Foundation core/EVM/extensions 2.29.0, SVM 2.28.0, Solana Kit 5.5.1, vulnerable Zod 3.25.76 in legacy paths, patched Foundation Zod 4.6.7 and minimatch 10.2.6. No dependency/lockfile change was made. Current CDP still requests Zod `^3.25.76`; current SVM 2.29.0 requires Kit >=8, incompatible with CDP's current Kit 5 graph. Current ESLint 10.14.0 requests minimatch `^10.2.6`; patched minimatch 11.0.1 is outside that supported range. Audit suggestions involving an old CDP release or ESLint major downgrade are not an acceptable fix. No force/override/suppression was used.

Fresh full audit: **5 high + 10 moderate (15 affected entries)**. Fresh production-only audit: **5 high**. This differs from historical 5+12 without any dependency remediation. Five high entries propagate Zod through CDP, abitype and the SVM/nested core path. Ten moderate entries propagate minimatch through ESLint/config-array and TypeScript ESLint tooling. These are two root advisories, not fifteen independent exploits: [Zod GHSA-mrhx-c7xc-m3w5](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5), [minimatch GHSA-g3hv-75wg-m249](https://github.com/advisories/GHSA-g3hv-75wg-m249).

The production import allowlist now admits only reviewed pure SG-05 leaves, registry/RPC/settlement-evidence/Builder Code leaves, patched Foundation parsers and the public CDP auth subtree/support modules. It rejects local gateway/admission/mock modules, SVM/Solana, full CDP x402/wallet APIs, vulnerable Zod and minimatch. Browser exclusion remains stricter: no payment SDK/server/test modules. Exact package versions are read from installed manifests during checks. **Runtime exclusion is not remediation of installed vulnerabilities, an independent audit or automatic release approval.** CI audits remain visible and failing. Owner/security review must accept the supported isolated boundary or require a compatible upstream fix before activation.

Official sources checked against installed types/source:

- [CDP Facilitator, including direct REST integration](https://docs.cdp.coinbase.com/x402/seller/facilitator).
- [CDP server authentication](https://docs.cdp.coinbase.com/api-reference/v2/authentication).
- [Cloudflare D1 API, batches and primary sessions](https://developers.cloudflare.com/d1/worker-api/d1-database/).
- Installed public export declarations and implementation for CDP auth/x402, Foundation v2 HTTP/types/schemas and Builder Code extensions. Public npm metadata was queried for current supported version/peer ranges.

## D1 migration 0009 and admission authority

`0009_sg07_payment_activation.sql` follows 0008. Historical migrations 0001–0008 are unchanged.

- `payment_manifests`: exact one-use operator approval for an immutable resource/configuration/handler tuple, maximum runtime approval horizon 30 days. Approval is permission to observe, not proof of registration or payment. Production realm is `operator_rpc`; local fixtures use `local_simulation` exclusively.
- Manifest replacement, deletion, renewal and unrevocation are rejected. Resource/binding changes or binding deletion permanently revoke it. Disable/re-enable cannot restore approval. There is no automatic/public resolution or renewal route; a future renewal policy requires explicit review.
- Attempts add activation realm, nonce, delivery-generation counter and permanent submission-start timestamp. Existing unique authorization/fingerprint indexes are reused.
- Append-only `payment_submission_reports` and `payment_chain_evidence`; permanent `payment_quarantine`.
- Activation receipts require matching chain identity and realm and cannot be updated/deleted. A local receipt can never be labeled confirmed_onchain. Existing receipt/payment history is not rewritten.
- Known delivery failures can retry at most three claims against fresh evidence, without any settlement transition. The old local gateway's terminal failure behavior remains unchanged for attempts outside the activation realm.

The operator's offline `node scripts/prepare-payment-manifest.mjs <owner-reviewed-local-resource-snapshot.json>` accepts actual exported `{resource,binding,merchant,expiresAt}` records, validates identity/commitment and emits review-only INSERT SQL. It neither accesses a network/database nor executes the SQL. It outputs no upstream URL or secret. It cannot prove registration. Every payable request independently rechecks real registry state; fixture observations and legacy onchain_confirmed labels are not sufficient.

## Recovery and limits

Unknown/pending retries perform read-only reconciliation; no settlement resubmission exists. If CDP's hash was persisted, re-read that exact transaction. If a response/hash was lost, a `transaction` query parameter is only an **untrusted lookup hint** supplied with the original signed authorization/ticket. The independent observer must prove the exact immutable authorization was actually consumed and paid correctly. No undocumented CDP status/idempotency endpoint or automatic scan/indexer is invented. Without a transaction candidate, the state stays unknown pending authorized investigation.

A receipt survives configuration revocation, provider failure, delivery failure and retry. Known failed delivery can retry with fresh proof and the original authorization; unknown outcomes never trigger another charge. Reporting remains ownership-filtered and deliberately conservative: stored production flags/receipts are not promoted into verified revenue metrics by the dashboard.

There is no distributed transaction across D1, CDP, RPC and HTTP. A crash between submission permission and the actual call may leave an uncharged-but-unknown attempt; a crash after submission can leave a paid-but-unknown attempt. Both deny fulfillment/resubmission. A final D1 compare-and-set cannot freeze external chain state or revoke a transaction already submitted. Once fulfillment is committed, loss of the HTTP response cannot prove whether the buyer received content; automatic second delivery/refund is not promised. Manual recovery/dispute/refund policy remains an owner decision, never an invented application capability.

RPC reports are independent of the facilitator, but remain assertions by the owner-selected RPC provider, not locally verified consensus proofs. Finalized state, maximum 30-minute finalized age, fresh head <=60 seconds, future skew <=1 second, canonical hash pinning and monotonic per-operation clock checks are enforced. Provider honesty/finality policy, production wall-clock assumptions, D1 availability/consistency and disaster recovery still require external approval and operational evidence.

## Non-executing owner activation checklist

**None of these external actions was executed. Do not activate until every mandatory gate is reviewed.**

1. Review source, test evidence, dependency boundary and residual advisories. Approve the fixed internal JSON pilot and finality/provider/clock/unknown-outcome/delivery-recovery policies. Do not mistake successful registry deployment/observation for a registered payable resource or payment authority.
2. Approve and publish code manually. Maintain `X402_PAYMENTS_ENABLED` unset/false and `X402_EMERGENCY_DISABLED` unset/true. Existing production origin, D1 identity, registry address and DNS remain unchanged.
3. Verify production backup/restore and migration history/checksums. Owner reports 0006 applied; 0007/0008 remain unapplied and 0009 is new. Inspect remote history **separately, with owner authorization**, before any migration operation. Where Wrangler history matches, the owner may later review `npx wrangler d1 migrations list signalarc-gate-db --remote --env production` and `npx wrangler d1 migrations apply signalarc-gate-db --remote --env production`. The latter applies ALL missing files: do not execute it against manually applied/unrecorded historical migrations. History alignment/individual application requires its own reviewed plan, not fabricated migration records. Required forward order: 0007 settlement observations, 0008 journal integrity, 0009 payment activation. Never roll back by deleting receipts or rewriting old migrations.
4. Owner provides `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET`, existing `REGISTRY_RPC_URL` only as Cloudflare server secrets. No VITE_ variables, wallet secret, private key, credential file, log or frontend transport is required. Review least permissions, CDP Base exact/Builder Code support, provider quotas and any billing terms. No live credential or key value is needed for local verification.
5. Independently review the real resource's wallet owner, payout, exact atomic price, salted commitment, registry version and canonical finalized registration. If absent, owner separately authorizes registration; this task never registers a fake resource. Export actual D1 rows and a bounded approval expiry, prepare/review the manifest SQL offline, and separately authorize its D1 insertion. Do not insert a local_simulation record as operator evidence or relabel old observations.
6. Review CDP's actual EIP-3009 transaction shape against the strict direct-USDC observer before charging. Router/batch/unsupported shapes remain blocked; supporting them requires a separately reviewed evidence decoder, not an SDK-success bypass.
7. Approve exactly one buyer/merchant address pair, exact USDC atomic amount, maximum USDC/ETH/provider spending budgets (owner supplied), evidence collection and stop rules. No values/funds are guessed here. Confirm the buyer handles 202 polling with the SAME issued authorization, retains it safely and never auto-signs a replacement while pending. Receipt evidence must include actual transaction, canonical receipt/logs/nonce/authorizationState, finalized anchors, D1 receipt and merchant-visible recovery status. Builder Code calldata attribution must be inspected independently; local suffix tests are not live attribution evidence.
8. Only after separate approval configure server vars `BASE_CHAIN_ID=8453`, `APP_ORIGIN=https://gate.signalarc.fun`, `X402_POLICY_ID=base-finalized-internal-json-v1`, `X402_PAYMENTS_ENABLED=true`, `X402_EMERGENCY_DISABLED=false`. No public header toggles these. Missing schema/secrets/manifest/registry/proof denies payment or fulfillment. A no-payment preflight and exactly one separately approved payment come before any wider enablement.

Emergency stop: owner sets `X402_EMERGENCY_DISABLED=true` and `X402_PAYMENTS_ENABLED=false`, and separately authorizes revoking the affected manifest (`revoked_at` non-null; permanent). Stop new settlement/delivery; do not delete journals/receipts, reset submission permits or retry a settlement. Already-submitted transactions may still settle. Disabled routes also stop automatic reconciliation; preserve evidence for an explicitly approved read-only investigation. Code rollback must leave the additive schema/evidence intact and switches disabled. Never use a rollback as a refund or proof of failure.

## Mandatory remaining gates

| Gate                                      | Status                  | Required next evidence/decision                                                                                               |
| ----------------------------------------- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| Installed dependency remediation          | BLOCKED                 | Compatible upstream fixed graph, or explicit security approval of documented supported production boundary; audits still fail |
| Hosted CDP auth/support/transaction shape | UNVERIFIED              | Separately approved credentials/permissions and read-only capability review; no live call made                                |
| Production migrations and exact manifest  | BLOCKED                 | Owner backup/history review and separately approved 0007–0009 application/actual resource approval                            |
| Registry resource/finality admission      | UNVERIFIED live         | Actual finalized registration/config tuple and approval of pinned Alchemy/finality policy, not a status flag                  |
| Trusted settlement and operational clock  | UNVERIFIED live         | Independent canonical actual USDC evidence, clock/quota/concurrency review; local fixtures are insufficient                   |
| Unknown settlement / delivery incidents   | OWNER DECISION REQUIRED | Explicit manual investigation, recovery, response-loss and dispute policies; never automatic recharging                       |
| General merchant upstreams                | BLOCKED                 | Separate enforceable transport/scope decision; internal JSON never fetches them                                               |
| One Mainnet payment                       | NOT AUTHORIZED here     | Exact addresses/budgets, stop rules, rollback, evidence requirements and immediate separate owner approval                    |

This is not independent security certification or permission to deploy/activate. SG-07 completion and any grant-readiness claim remain for owner/ChatGPT review.

## Final verification evidence

All final commands below completed locally. The aggregate invoked each listed suite's real npm subprocess, not a count inferred from old reports.

| Command                                                                                                    | Exit  | Actual result                                                                                                                                                                           |
| ---------------------------------------------------------------------------------------------------------- | ----- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm ci`                                                                                                   | 0     | Locked installation; dependency audit warnings remain                                                                                                                                   |
| `npm run build`                                                                                            | 0     | TypeScript/Vite                                                                                                                                                                         |
| `npm run lint`                                                                                             | 0     | ESLint                                                                                                                                                                                  |
| `npm run format:check`                                                                                     | 0     | Prettier; documentation checked again after this evidence update                                                                                                                        |
| `npm run test:activation`                                                                                  | 0     | **42** native workerd/D1 activation checks, separately executed                                                                                                                         |
| `npm test`                                                                                                 | 0     | **533** groups across all eleven suites                                                                                                                                                 |
| `npm run build:functions`                                                                                  | 0     | Real local Wrangler Functions bundle                                                                                                                                                    |
| `npm run check:bundle-boundary`                                                                            | 0     | **700** Functions inputs; **1,781** browser inputs / two chunks; no vulnerable Zod, SVM/Solana, full CDP x402/wallet, minimatch or mock gateway in Functions; no payment SDK in browser |
| `npm ls zod minimatch @coinbase/cdp-sdk @x402/core @x402/evm @x402/extensions @x402/svm @solana/kit --all` | 0     | Supported installed peer tree; no dependency modifications                                                                                                                              |
| `npm audit` and full JSON audit                                                                            | **1** | **5 high + 10 moderate**, unresolved                                                                                                                                                    |
| `npm audit --omit=dev` and JSON variant                                                                    | **1** | **5 high**, unresolved                                                                                                                                                                  |
| `forge fmt --check`                                                                                        | 0     | No contract changes                                                                                                                                                                     |
| `forge build --sizes`                                                                                      | 0     | Runtime 4,172 bytes; initcode 4,239 bytes; pinned compiler unchanged                                                                                                                    |
| `forge test -vvv`                                                                                          | 0     | **47 passed**, zero failed/skipped                                                                                                                                                      |
| `forge test --gas-report`                                                                                  | 0     | Same **47** passed; local measurements only                                                                                                                                             |
| Standalone `node scripts/migrate-local.mjs --persist-to <owned temporary directory>` twice                 | 0 / 0 | First applies 0001–0009; second reports already applied/checksums verified; owned temporary state removed                                                                               |
| Historical migration comparison against HEAD                                                               | 0     | 0001–0008 byte-for-byte unchanged                                                                                                                                                       |
| `git diff --check`, read-only status                                                                       | 0     | No whitespace errors; existing branch/HEAD and all twelve archives preserved                                                                                                            |

Suite counts: foundation **17**, compatibility **14**, SG-03 **14**, SG-05 **192**, SG-06 **20**, SG-07 **75**, registry admission **43**, upstream security **32**, release security **76**, Builder Code **8**, activation **42** = **533**. Existing native D1 and Chromium desktop/mobile/authentication/reporting checks ran. Existing SG-05 real Pages-process interruption/restart tests passed; new activation tests use fresh gateway instances and durable native D1 state, expired operation leases, lost reports and atomic receipt faults. Successful receipts in every test remain LOCAL SIMULATION ONLY.

New activation assertions cover actual facilitator counts and persisted rows, canonical token/nonce/signature checks, wrong requirements/chain/asset/recipient, malformed signatures, expiration, concurrent claims/replay, trusted-realm separation, missing schema/credentials/emergency switch, immutable submission permission, D1 receipt/analytics rollback, valid anchor progression, permanent conflict quarantine/replay, revocation/merchant edits, unknown outcomes and transaction hints, failed delivery/retry without charging, stale delivery generations, canonical reorg denial, owner manifest tooling, actual public JWT execution, production route isolation and preserved health JSON.

The Functions artifact measured 1,300,531 raw bytes / 228,689 gzip bytes; these are local build measurements, not Cloudflare capacity or billing evidence. Earlier aggregate execution stopped on a stale expected final migration name (0008); the assertion was corrected to require 0009, then the final complete aggregate passed. Intermediate activation prototypes failed signature type checking, RPC-fixture canonical/clock/redirect handling and deadline assertions; those were corrected, with final security assertions retained. Tests were not converted into expected failures. Initial strict registry policy rejected the trusted deployment pin's mixed-case spelling as non-EIP-55; the server-owned pin is normalized to lowercase before strict reader validation, without weakening merchant wallet validation. Final tests and build supersede those intermediate failures. The dependency audit failures above remain real failures.

Local logs/metafiles are ignored under `.wrangler/activation-*`; no generated artifact is part of the source inventory. No existing archive, migration checksum, production configuration, contract source or lockfile was changed.

## Exact changed-file inventory

- `docs/ENVIRONMENT.md`
- `docs/RELEASE_CHECKLIST.md`
- `docs/SG-07_REMEDIATION_REPORT.md`
- `docs/SG-07_X402_PRODUCTION_ACTIVATION_REPORT.md`
- `migrations/0009_sg07_payment_activation.sql`
- `package.json`
- `scripts/dependency-exposure.mjs`
- `scripts/local-runtime.mjs`
- `scripts/payment-bundle-policy.mjs`
- `scripts/prepare-payment-manifest.mjs`
- `server/payments/authority.ts`
- `server/payments/config.ts`
- `server/payments/document.ts`
- `server/payments/facilitator.ts`
- `server/payments/gateway.ts`
- `server/payments/protocol.ts`
- `server/payments/route.ts`
- `server/payments/store.ts`
- `server/sg03/api.ts`
- `server/sg03/budget.ts`
- `server/sg05/protocol.ts`
- `server/sg06/reporting.ts`
- `server/sg07/internal-json.ts`
- `tests/activation/handler.ts`
- `tests/activation/run.mjs`
- `tests/activation/tsconfig.json`
- `tests/registry-admission/run.mjs`
- `tests/release-security/run.mjs`
- `tests/sg03/run.mjs`
- `tests/sg05/run.mjs`
- `tests/sg06/run.mjs`
- `tests/sg07/run.mjs`
- `tests/upstream-security/run.mjs`

New forward migration SHA-256: `5bb1b82b753c8ce23d8d974dc410d33758f6e0143564c6a4468306491c5e493e`.

**Stop for owner/ChatGPT review. Production activation remains BLOCKED; SG-07 remains IN PROGRESS.** The next action is review/approval of this code and supported dependency boundary plus the explicit migration, resource, CDP, finality/clock and one-payment decision packet—not an automatic production payment.
