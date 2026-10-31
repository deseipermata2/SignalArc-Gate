# Release checklist and non-executing SG-07 approval packet

**Verdict: BLOCKED for public payments or production launch.** This is a planning/review artifact, not permission to launch. SG-00 through SG-06 are owner-approved complete. SG-07 readiness/remediation is IN PROGRESS; launch is not authorized. A passing local test or a database provenance flag cannot convert a blocker into PASS.

No deployment, secret provisioning, contract transaction, remote migration, paid API, DNS change or Mainnet smoke test is executed by this checklist. Current local evidence and dependency findings belong in [SG-07_READINESS_REPORT.md](SG-07_READINESS_REPORT.md); [SG-06_REPORT.md](SG-06_REPORT.md) is historical evidence; the prior [SG-05 plan](SG-05_REPORT.md) remains historical evidence.

## Mandatory launch gates

| Gate                             | Current evidence / missing requirement                                                                                                                                                            | Status        |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------- |
| Owner phase/release approval     | SG-07 local readiness evidence awaits review; no launch authorization                                                                                                                             | BLOCKED       |
| Dependency security              | Partial compatible remediation does not eliminate CDP/SVM Zod 3 or tooling findings; fresh audit remains failing                                                                                  | BLOCKED       |
| Immutable contract/compiler      | Local tests and SG-07 ABI comparison only. Solidity 0.8.28 uses legacy codegen and disabled Yul optimization; current patched compiler validation and independent contract review remain required | BLOCKED       |
| Registry deployment/verification | No deployed canonical registry address or explorer/code-verification evidence supplied                                                                                                            | BLOCKED       |
| Registry observation / D1 sync   | Read-only code-hash/finalized hash adapter tested locally; actual deployment provenance, RPC trust and D1 evidence admission remain missing                                                       | BLOCKED       |
| Facilitator authentication       | Official helper bundles and empty-credential guard runs; actual CDP JWT, credentials, supported permissions, billing and Mainnet settlement remain unverified                                     | BLOCKED       |
| Reconciliation                   | Local simulator ledger only; no authoritative production lookup/admission or operator recovery service                                                                                            | BLOCKED       |
| Upstream connection security     | URL checks and redirect rejection are insufficient for DNS rebinding/actual connection safety. No production outbound transport exists                                                            | BLOCKED       |
| Time/authorization expiry        | Local fixtures use a trusted monotonic clock capability. Production clock behavior and bounded streaming deadlines need proof                                                                     | BLOCKED       |
| TLS/origin/wallet acceptance     | Actual deployed HTTPS, real injected-wallet variants, origin policy and cookie behavior have no production evidence                                                                               | BLOCKED       |
| Payment intent / delivery policy | EIP-3009 does not sign an HTTP URL/version; stolen bearer-header and consistency-window policy need review. Paid-but-unfulfilled handling/refunds require owner policy                            | BLOCKED       |
| Abuse and capacity               | No production-wide authenticated read/concurrency/storage/ingress limiter or capacity/cost measurement. Platform quotas are not security controls                                                 | BLOCKED       |
| Remote D1 and migrations         | Local SQL/ledger only; no real account binding, backup/restore or production migration execution                                                                                                  | BLOCKED       |
| Production evidence/metrics      | Self-labelled confirmations are quarantined. Verified Mainnet metrics remain unavailable until trustworthy evidence admission exists                                                              | BLOCKED       |
| Public route exposure            | Normal Functions excludes SG-05 gateway/fixtures/payment SDKs; this boundary must remain until every required gate is approved                                                                    | KEEP DISABLED |

## Intended contract deployment process — planning only

1. Owner selects the reviewed source revision, reproducible compiler/build configuration and Base Mainnet target **8453**. No public testnet or substitute scheme/network is acceptable. Evaluate a current patched Solidity compiler separately; do not silently change the approved artifact. Review current official compiler bugs against exact codegen/optimizer/source and rerun all unit/fuzz/invariant/gas tests.
2. Have the immutable no-admin/non-custodial design independently reviewed. Confirm owner-namespaced UUID mapping, exact atomic price cap, salted private configuration commitment, reversible disable, optimistic version checks and two-step transfer behavior. Lost ownership keys or assets mistakenly sent to the registry have no privileged recovery route.
3. Generate final constructor/creation/runtime artifact hashes and compare reproducible output. Constructor checks Base chain 8453. Verify deployment has no payable/fund transfer/settlement functions, proxy or upgrade authority. The registry does not prove a payment succeeded.
4. Estimate deployment gas for the **exact** creation bytecode and current Base transaction context using read-only estimation or an approved non-broadcast fork. Local Forge gas units are not a fee quotation. Include intrinsic/calldata costs, L2 effective gas price, L1 data/security fee and applicable operator fee:

   `estimated ETH = (gasUsed × effectiveGasPriceWei + l1FeeWei + operatorFeeWei) / 10^18`

   Do not invent current gas/ETH prices or promise an exact fee. Owner must approve a maximum ETH spend, gas limit/fee caps, deploying wallet and timing immediately before any signing/broadcast. Deployment is not currently authorized.

5. Use the owner's wallet directly; never request/export/store its private key or seed. Independently confirm chain ID and constructor bytecode in the signing interface. A future deployment procedure/script must be reviewed first; no live deployment script or funded-wallet configuration is introduced here.
6. After separately authorized execution, collect transaction hash, successful canonical receipt, block/hash/finality, deployed address/runtime code hash and Base explorer verification using the exact compiler/settings/source/constructor. Check verified code matches the approved artifact. An explorer URL alone or client-supplied hash is insufficient.
7. Only then approve the canonical address and registry observation policy. Do not paste a made-up address into D1, environment files or dashboard metrics. Onchain configuration mutations/disable/transfer are further transactions requiring explicit authorization and fee budgets.

## USDC, facilitator and durable state admission

- Verify **Base Mainnet 8453**, `eip155:8453`, and official native USDC **`0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`** against official issuer/Base references and reviewed contract/token metadata. Reject a bridged or similarly named token. USDC uses six decimals; preserve atomic integer strings/BigInt.
- Owner confirms actual merchant/current/original registry owner, payout control and buyer address. Payout is not merchant authorization. D1/session identity, current registry owner/version/hash, enabled state and approved deployment must agree. Pending transfer, stale/unconfirmed block, owner mismatch or changed price/payee disables fulfillment.
- Provision only necessary CDP API permissions, entitlement, restrictions and approved cost limits. Existing SDK secret names are `CDP_API_KEY_ID` and `CDP_API_KEY_SECRET`; neither was requested/read here. JWT generation and real supported/verify/settle behavior require explicit authorization and evidence. No gateway custody or buyer auto-signing service should be added.
- Implement an authoritative confirmation/reconciliation path before allowing public settlement. A timeout/drop/HTTP error may follow submission and must remain unknown. Never expire a settlement lease into a new submission. Bind evidence to the unique authorization, exact asset/payer/payee/amount/resource/version and approved chain. A transaction-shaped string, simulation result or database label is not proof.
- Preserve atomic receipt/event persistence and immutable attempt identity. `fulfilled` means a release claim, not confirmed client receipt. Choose an owner-approved paid-but-unfulfilled policy, operator escalation, retention and any merchant refund process. Do not erase/retry charges to repair delivery; this system cannot unilaterally transfer merchant funds.
- Implement verified evidence admission before changing dashboard `verified.available`. Existing `confirmed_onchain` labels must not automatically become genuine volume. No positive production record is invented as a QA fixture.

## DNS/SSRF, headers and operations

- Establish how a real Cloudflare connection is guaranteed to use an approved public destination after DNS/CNAME resolution and through redirects. Inspect the exact fetch/connection behavior, IPv4/IPv6/reserved ranges, metadata destinations, rebinding/redirect windows, TLS/SNI/host behavior and authorization-header isolation. If this cannot be guaranteed on the selected runtime, keep fetching disabled and seek an explicit owner architecture decision. Do not use an unrestricted proxy or weaken URL validation.
- Retain strict methods/content types, header/body/JSON/collection limits, streamed byte caps, cancellation and elapsed-time checks. Prove actual production clock/deadline behavior. Recheck config before settlement and before delivery; document the non-atomic chain/D1/upstream boundary.
- Review CSP and other static/API headers on the actual deployed host. `public/_headers` does not protect Functions automatically; API responses set explicit policy. Require no-store, no raw signatures/cookies/upstream credentials in logs, least-privilege CORS/origin/CSRF policy and Secure `__Host-` session cookies over HTTPS.
- Define enforceable per-identity/IP/concurrency/read/write/retention limits and 429/incident behavior, including failure when rate-control infrastructure is unavailable. Existing nonce issuance limits are not a global limiter. No free-tier daily quota should be presented as abuse prevention.
- Check current Cloudflare account plan, Workers/Pages CPU/request/subrequest/bundle limits and D1 read/write/storage/batch limits, backups and log retention. Measure the exact release artifact and expected workload. Obtain owner-approved budget caps and alerts before any paid allowance; no capacity, cost or account entitlement is fabricated here.

## Production environment and Cloudflare/D1 planning

Existing implemented names, without secret values:

| Name                                   | Required meaning                                                                           |
| -------------------------------------- | ------------------------------------------------------------------------------------------ |
| `APP_ORIGIN`                           | Exact approved HTTPS origin, no path/trailing slash; never inferred from forwarded headers |
| `BASE_CHAIN_ID`                        | Existing string `8453`                                                                     |
| `SIGNALARC_DB`                         | Owner-provisioned genuine D1 binding/identity; no fake UUID                                |
| `APP_ENV`                              | Only explicit loopback local HTTP uses `local`; never enable public insecure cookies       |
| `CDP_API_KEY_ID`, `CDP_API_KEY_SECRET` | Future approved server secrets only, never VITE/public variables                           |

No production knobs for registry synchronization, receipt admission, clock, reconciliation or safe upstream transport exist yet. SG-07 adds server-injected registry policy/RPC and facilitator boundary modules, not environment activation or production evidence admission. Design/review the remaining capabilities rather than inventing environment values. `SG02*`, `SG05_LOCAL_ONLY`, `SG06_LOCAL_ONLY`, `SG07_LOCAL_ONLY`, fixture Pages URLs and `MOCK_ORIGIN` must not enter production bindings or routes.

Before any remote migration: owner approves actual account/database, backup/restore test, migration digests/order, compatibility window and rollback/data-retention strategy. The local migration ledger is not evidence of provisioned production Wrangler/D1 identities. An index-only SG-06 migration does not authorize remote operations. Never rewrite applied migration history or delete payment records as rollback.

## Proposed gate.signalarc.fun / Hostinger connection — no changes made

1. Owner verifies the actual authoritative DNS provider and existing zone/record ownership, including whether Hostinger manages the relevant zone. No account inspection/change has been performed here.
2. After explicit SG-07 approval, owner selects the actual Cloudflare Pages project and obtains its real custom-domain target. Do not invent a CNAME target, deployment URL or account identifier.
3. Prepare the exact `gate.signalarc.fun` record change for final review. Preserve apex, mail, verification, nameserver, DNSSEC/CAA and unrelated application records. Do not modify WizPay or any unrelated domain/service.
4. Owner separately approves Cloudflare custom-domain enrollment and the exact Hostinger DNS mutation immediately before execution. Verify certificate issuance and HTTPS independently. Set `APP_ORIGIN` to the approved HTTPS host only after authorized provisioning; changing origins invalidates old session scope.
5. Check origin/Host spoofing, redirects, CORS/CSRF, headers, Secure cookies and absence of mock/paid routes through both the custom domain and provider URL. Keep payment release disabled until all payment/security gates independently pass. No DNS change implies payment approval.

## Exact separately approved Mainnet smoke test

The [SG-05 non-executing plan](SG-05_REPORT.md) supplies the detailed lifecycle. Before execution the owner must approve, in one concrete review packet:

- Exact source/artifact/deployment/registry/resource version, payout, buyer and Base native token; proof all security gates pass.
- The precise USDC amount, minimum buyer funding for that amount, maximum USDC per attempt/total, maximum ETH/fees, facilitator credit/cost cap, maximum attempts and approved time window. Values are owner decisions, not guessed budgets.
- Gas payer/sponsorship/billing, facilitator permissions, any production migration/environment/domain actions and their individual approvals.
- The exact signing/broadcast/verify/settle/upstream requests permitted and an operator available to stop the surface.

Then, only after immediate final authorization: observe an unpaid 402 with exact v2 requirements; obtain informed buyer consent; verify and settle once; persist the attempt/receipt; admit only authoritative confirmed evidence; release one protected response. Collect Base transaction/receipt/block/finality and official USDC Transfer/authorization-consumption evidence with exact payer/payee/atomic amount, CDP decisions, D1 transitions and actual fee evidence. A mocked hash, HTTP 200 or dashboard badge is insufficient.

On uncertainty, mismatch, reorg or delivery failure: close routing, retain evidence, mark unresolved/failed-delivery correctly and stop automatic retries. Reconcile authoritatively without a second charge. Reopening, additional paid attempts, refunds, contract changes or new spending require owner approval. Rolling back exposure does not roll back a blockchain transfer or authorize deleting history.

## Review exit

SG-07 can be reviewed as a **local-only readiness** candidate while production release remains blocked. Owner/ChatGPT must approve launch actions separately and phase completion explicitly. No item becomes PASS because CI is green. Do not deploy, broadcast, fund a wallet, provision credentials, change DNS, mutate Git or start SG-08 from this document. See the current [SG-07 gate evidence](SG-07_READINESS_REPORT.md) and [non-executing launch runbook](SG-07_LAUNCH_RUNBOOK.md).
