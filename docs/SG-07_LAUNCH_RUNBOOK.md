# SG-07 launch runbook — NON-EXECUTING

**PRODUCTION READINESS BLOCKED. OWNER AUTHORIZATION REQUIRED.** This document is a review packet, not permission to launch. SG-07 stays IN PROGRESS. No command below authorizes deployment, signing, broadcasting, settlement, remote migration, credentials, DNS changes or spending. No live deployment script was created. Stop at each approval boundary if the required evidence or budget is missing.

## 1. Freeze the candidate and security decisions

Owner/ChatGPT review the exact source revision, lockfile, compiler settings, migration digests, local tests and [readiness gates](SG-07_READINESS_REPORT.md). Resolve significant dependency findings without unsupported overrides. Approve the contract compiler after comparing a current patched compiler and independent contract review; current 0.8.28 legacy/Yul-disabled tests are not a production compiler certificate.

Approve the exact canonical registry source/build/code hash, original-owner UUID mapping, configuration commitment, immutable/no-admin design, reversible disable and two-step transfer behavior. Approve finalized-block policy, trusted RPC endpoint/provider assumptions, freshness/confirmation thresholds and incident thresholds. No deployment address, RPC account or approved finality values have been supplied.

Before release, implement and review real registry observation/admission, production reconciliation, safe clock behavior, connection-safe upstream transport, rate limits and production evidence metrics. A local RPC report, database confirmation label or facilitator transaction string is insufficient. Keep paid routes absent until these prerequisites pass.

## 2. Separate approval: Base registry deployment and source verification

Owner selects the actual deployment wallet, confirms control without exposing its keys, verifies chain **8453**, approves a **maximum ETH gas/total-fee budget**, time window and one intended deployment. No budget amount or balance is guessed here. Prepare and review exact creation bytecode, constructor inputs (none), compiler binary/version/settings, source/license, runtime code hash and resulting source-verification inputs before any signing.

Estimate using the exact release artifact and approved fee parameters. Local gas units are not a live Base fee quote. Execution ETH estimate is `gasUsed × effectiveGasPriceWei / 10^18`; account separately for Base L1 data/operator/other applicable fees and owner-approved headroom. Confirm the current fee model before approval. Stop if the wallet, estimated fee, bytecode, chain or limits differ.

Only with fresh explicit owner authorization may a human-controlled wallet sign/broadcast the approved deployment. Record actual deployment transaction, canonical successful receipt/block, deployed address, runtime code, chain and required finality. Compare deployed bytecode hash to the approved artifact at a finalized block. Verify source on the correct Base explorer using the exact compiler/settings; a verification badge alone does not establish canonical deployment or security. Record explorer evidence without inventing a hash/address. Owner approves that exact address/code hash for server configuration only after review.

## 3. Attribution decision

Review the current official [Base Builder Codes](https://docs.base.org/specifications/builder-codes/overview) / ERC-8021 mechanism. Owner supplies or separately authorizes registering the actual project/code through the Base dashboard, with account/cost review. No code is invented or registered here. Determine which approved wallet/tool/facilitator can preserve the required attribution suffix. Do not alter signed EIP-3009 data, replace merchant payout, provision a wallet or assume CDP-generated settlement includes attribution. Obtain facilitator-specific evidence; if unsupported, document the attribution limitation and seek the owner's decision. Attribution never proves payment success or guarantees rewards.

## 4. Separate approval: Cloudflare publication and real D1

Owner approves the actual Cloudflare account/project, free-tier limits and capacity, spending caps/alerts, deployment origin and any paid entitlement. No new public URL is approved by this runbook. Before remote migration, identify the genuine D1 database and `SIGNALARC_DB` binding, verify a backup/restore procedure, migration checksums/order and transaction/data-retention/rollback policy. The local helper has no remote option and must not be repurposed to silently target production.

Owner performs or separately authorizes publication and remote migrations only after reviewing the concrete artifact/binding/migration plan. Do not invent a D1 UUID or substitute a local flag. Set real server `APP_ORIGIN` and `BASE_CHAIN_ID=8453`. Never enable `APP_ENV=local`, SG02/SG05/SG06/SG07 fixture flags, mock URLs or test routes on a public host. Verify HTTPS cookies, exact origin/CSRF, CORS, static/Functions security headers, merchant isolation, health and absence of payment/mock routes through both provider/custom hosts before opening any new surface.

## 5. Separate approval: CDP credentials, registry and transport

Owner reviews CDP production eligibility, facilitator verify/settle permissions, billing/gas payer, limits and emergency revocation. Only then may the owner provision `CDP_API_KEY_ID` / `CDP_API_KEY_SECRET` as server secrets. No values enter source, logs, browser `VITE_` variables or documentation. No wallet secret is needed merely to authenticate this facilitator. Actual JWT signing/authenticated calls have not been exercised locally.

Validate the official SDK version and bounded pre-parse HTTP behavior, timeouts, supported exact Base/native-USDC upfront requirements and ambiguous-response policy before real use. Confirm the production client does not retry settlement automatically. Registry address/code, original/current owner, payout, price, hash/version, disabled/pending transfer and finalized/canonical observations must agree with server D1. Establish D1 admission checkpoints, reorg handling and per-fulfillment revalidation. Merely attaching the SG-07 reader to SG-05 is not a reviewed integration.

Choose and prove a DNS/actual-connection-safe upstream transport. A hostname allowlist or independent DNS lookup is not sufficient. If only owner-controlled resources can be supported safely, explicitly approve that reduced scope and prove its routing/TLS/connection policy. No arbitrary merchant proxy may be enabled while the property is unproven. Establish body/JSON/time/concurrency limits and upstream cancellation behavior.

## 6. Separate approval: gate.signalarc.fun through Hostinger

Owner verifies authoritative DNS management and current zone records; no zone/account inspection has occurred. After selecting a genuine approved Pages project, obtain the actual custom-domain target, prepare the precise `gate.signalarc.fun` change and review it before execution. Preserve mail, apex, verification, nameserver, DNSSEC/CAA and unrelated records. No WizPay or unrelated infrastructure changes are authorized.

Owner separately approves the exact Hostinger/Cloudflare mutations and certificate enrollment. Verify DNS propagation, actual TLS, origin policy and public route isolation; set the approved HTTPS origin deliberately. Reverting DNS is not a payment rollback. Domain publication never authorizes paid routing.

## 7. Exactly one initial Mainnet payment — separate immediate approval

Execute only after all mandatory security gates pass. Owner chooses the real merchant owner/payout and buyer addresses, approved registry/resource/version/hash, exact positive integer USDC price and window. Verify native Base USDC against [Circle's contract list](https://developers.circle.com/stablecoins/usdc-contract-addresses): **0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913**, six decimals. No replacement/bridged asset or test network.

Obtain immediate explicit approval for **one** initial payment, exact USDC per-attempt/total cap, maximum ETH/total-fee cap, CDP charges/credits cap, selected gas payer, minimum required balances and time window. Amounts and balances are owner decisions/observations, not estimates fabricated here. Additional attempts, refunds or budget increases require new authorization. Signing consent must explain the exact asset, payout, amount and EIP-3009 authorization; never copy keys or raw authorizations into logs.

After that approval, the intended reviewed sequence is: observe the unpaid v2 402 and server-issued requirement identity; obtain buyer consent; verify once; settle through the approved durable pending claim; persist the facilitator report; independently admit authoritative final evidence; release at most one protected JSON response. Do not re-submit an authorization after timeout/lost response. Capture sanitized correlation IDs and state transitions, not bearer payment headers.

Required evidence: actual Base transaction/hash, canonical successful receipt/block/finality, approved native-USDC Transfer and authorization-consumption evidence with exact buyer/payee/atomic amount, verified registry state/code/configuration, facilitator verify/settle evidence, durable D1 receipt/provenance and one response-release decision. Check actual gas/data/operator fees against caps and retain explorer links. An HTTP 200, mock hash, SDK success boolean, local database label or release claim alone is insufficient to prove real payment/delivery.

## 8. Recovery, rollback and disputes

On timeout, drop, contradictory evidence, reorg, stale configuration, duplicate initiation, unsafe egress or exceeded budget: close paid exposure first, preserve D1/evidence and mark the correct uncertain/delivery-failed status. Do not reset nonce/idempotency records, delete receipts or expire an unknown attempt into another settlement.

For unknown settlement, an authorized operator must compare the exact network/token/payer/payee/amount/authorization nonce, facilitator submission evidence, canonical chain receipt/logs and finality. Only reviewed authoritative evidence can resolve it; lack of a receipt alone does not prove non-submission. Never trust a client hash or manually edit a database flag into success. No production reconciliation service or recovery endpoint is implemented yet.

Paid-but-unfulfilled cases retain settled evidence, cannot be charged again automatically and require an owner-approved delivery/refund/dispute policy. `fulfilled` means committed release, not proven buyer receipt. The registry/gateway has no custody/refund authority; any merchant refund is a separate owner/merchant-authorized transfer, never performed by this runbook.

Roll back the published artifact/route/configuration only using a reviewed compatible version and preserve migration/payment history. Onchain disable/replacement transactions, credential revocation/provisioning, DNS changes, additional payment attempts and reopening require their own approvals. Deployment rollback cannot reverse a USDC transfer. Review the one-test evidence before any further operation; no automatic launch expansion or next phase is permitted.
