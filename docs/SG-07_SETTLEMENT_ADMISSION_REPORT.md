# SG-07 settlement admission architecture and dependency continuation

**LOCAL READY FOR OWNER REVIEW; production launch BLOCKED. SG-07 remains IN PROGRESS.** This report distinguishes a tested local pre-admission architecture from unavailable production evidence authority. It is not launch approval or an independent audit.

## Checkpoint and scope

Read-only Git inspection confirmed branch `wip/sg07-remediation-20261102`, HEAD `6af7855`, and the previous uncommitted 463-check implementation. All previous modifications and twelve archives were preserved. No applicable AGENTS.md or canonical V2 rules/roadmap files were found in the repository or applicable ancestors. The supplied SG-07 status is retained; the unavailable canonical ledger cannot be independently reconciled. Older `main` references are historical, not the current working branch. No roadmap checkbox was edited.

The deployed Base registry and Alchemy observation are acknowledged owner evidence, not new live verification or resource/payment admission. No public RPC, live CDP/upstream request, production API inspection, signing credential, production migration or external mutation was used. Tests use existing isolated unfunded cryptographic fixtures; no wallet provider/transaction signing or spending is performed.

## New components and integration

`server/sg07/settlement-admission.ts` composes the existing observer, payment store and append-only settlement review journal. It accepts only explicit loopback/local opt-in with actual miniflare D1 and `LOCAL_SIMULATION_ONLY` source. A production realm is rejected before RPC. No production approval flag, public route, SDK response input, environment credential lookup, provider fallback or settlement submission exists.

The service:

1. Loads an unknown local attempt owned by the exact server-supplied merchant. It binds the complete immutable attempt, including resource, snapshot, revision/generation, amount, payout, authorization identity/fingerprint and request identity.
2. Derives the authorization identity from the exact Base/native-USDC/payer/nonce tuple and rejects nonce mismatch before observing chain evidence.
3. Calls the existing independent observer. It verifies successful canonical receipt/transaction linkage, direct native USDC calldata, recovered signature and authorization fingerprint, exact buyer/recipient/amount, Transfer and AuthorizationUsed logs, finalized block identity/depth/freshness/rechecks and consumed nonce at a hash-pinned canonical block. The observation now explicitly includes its decoded authorization nonce.
4. Rechecks the attempt and persists an existing migration-0007 review checkpoint. Conflicting evidence stays quarantined. This writes no receipt, analytics or payment phase.
5. Issues a frozen, process-bound candidate tracked by a private WeakMap. Only the issuing instance can consume the original object once, within ten seconds, for the exact merchant/attempt. JSON clones, database row IDs, public flags, wrong owners and other instances are not authority. Consumption rereads D1 identity, exact journal payload/transaction and durable conflict history. Operation deadlines and abort checks prevent late results from becoming usable candidates.

The isolated pilot reconciliation callback now prepares and consumes this checkpoint before the existing settlement CAS. Direct pending settlement and delivery retain their previous independent chain checks. Review candidates never independently authorize fulfillment: the gateway still requires its durable local receipt, exact live registry/resource/manifest, revocation checks and fulfillment CAS. Production remains excluded from every successful path.

Payment truth and current delivery permission remain separate. A revoked or modified resource cannot deliver content, but valid evidence of an already-submitted payment may still be recorded. Unknown outcomes are not retried for settlement. Worker restart preserves the journal and uncertainty, destroys any in-memory candidate, and requires fresh observation to rebuild a candidate. No invented CDP status endpoint is used.

## Durable conflict defects and correction

Review found two gaps:

- The settlement store did not check historical settlement-review conflicts inside its atomic receipt transition. A later local reconciliation could otherwise bypass journal quarantine. The settlement UPDATE now includes a prepared `NOT EXISTS` conflict condition inside the same D1 batch that inserts the receipt and analytics. Fulfillment phase claims also reject that history. A conflict inserted after candidate consumption still prevents the receipt CAS; evidence already persisted is not deleted or rewritten.
- Migration 0007's update/delete guards did not prevent SQLite `INSERT OR REPLACE` from deleting and replacing a journal row under the same ID. The adversarial native-D1 test reproduced this: replacement removed the conflict and candidate consumption unexpectedly succeeded. This was an internal SQL durability gap, not an exposed public SQL operation.

New forward migration **`0008_sg07_settlement_journal_integrity.sql`** adds a BEFORE INSERT guard rejecting an already-existing journal ID. It blocks REPLACE/identity collisions without changing any historical migration, table, receipt, phase or evidence-provenance policy. There is no automatic conflict resolution. Tests verify replacement remains rejected and the conflict rows persist.

The first draft's local migration application returned HTTP 500 because the local harness split the trigger body without its explicit `-- signalarc:statement` marker. The un-applied draft was corrected; migration application and checksum-preserving repetition now pass. SHA-256 checks confirm 0001–0007 are byte-for-byte unchanged. Test expected migration lists now include 0008; assertions were updated for the real schema, not weakened.

**Non-executing production proposal:** review the exact 0008 file/digest (`006df801ed21962a40b361259868df595c383e95597aca3888ea257408973ba5`) and the existing 0007 digest with backup/rollback and operator ownership. The owner must inspect the actual remote migration ledger first, approve any pending prerequisites in order and separately authorize rollout. No remote migration or configuration change occurred. The public control plane does not import this payment store, so production payment activation is not implied or needed for this local correction. Production admission/revocation authority will require a separately reviewed forward schema after this correction; no such authority table or confirmation-enabling trigger was added here.

## Dependency investigation and narrow supported boundary

Fresh npm metadata still does not provide a compatible secure installed graph:

| Parent/path                                    | Current supported declaration                 | Result                                                               |
| ---------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------- |
| CDP 1.60.0                                     | Zod `^3.25.76`, abitype `1.0.6`, Kit `^5.5.1` | Vulnerable Zod 3 retained; patched Zod 4 cannot satisfy these ranges |
| SVM 2.28.0                                     | Nested core 2.28/Zod 3                        | Installed vulnerable path remains                                    |
| Latest SVM 2.29.0                              | Kit `>=8.0.0`                                 | Not a supported drop-in for CDP's Kit 5 integration/program peers    |
| Root core/EVM/extensions 2.29.0                | Zod `^4.6.6`, installed 4.6.7                 | Already patched; does not replace nested core/CDP Zod                |
| Latest ESLint 10.14.0                          | minimatch `^10.2.6`, config-array `^0.23.5`   | New release does not fix this advisory; no cosmetic upgrade made     |
| config-array 0.23.5 / typescript-estree 8.72.1 | minimatch `^10.2.4` / `^10.2.2`               | Patched minimatch 11 remains outside parent ranges                   |

[Zod advisory](https://github.com/advisories/GHSA-mrhx-c7xc-m3w5) requires >=4.6.6; [minimatch advisory](https://github.com/advisories/GHSA-g3hv-75wg-m249) requires >=11.0.1. Latest metadata remains Zod 4.6.7/minimatch 11.0.4. The alternate `@coinbase/x402` 2.1.0 still depends on CDP and Zod 3. No dependency versions or lockfile were changed, no peers forced and no advisories suppressed.

A narrower same-facilitator option was investigated rather than retrying incompatible upgrades:

- Public `@coinbase/cdp-sdk/auth` exposes `generateJwt`; official Foundation `HTTPFacilitatorClient` exposes per-operation `createAuthHeaders`. The installed CDP facilitator helper itself composes those APIs. This is a package export subpath, **not** a separately installable npm package.
- `npm run check:cdp-auth-boundary` reproducibly builds those public exports using the installed esbuild and worker/browser conditions. Its graph has **220 inputs**, **812,315 unminified bytes**, only patched **Zod 4.6.7**, and no SVM, Solana or vulnerable Zod 3 inputs. Native workerd separately loads both public entry points with no credentials/signing/network call. The byte count is a local isolated build, not deployed size or a fee estimate.
- This is a **build/runtime entry-point candidate**, not a replacement production integration or an installed vulnerability fix. Actual JWT/key-format/clock behavior, CDP permission/host/path binding and live acceptance are unverified. The current public Functions still exclude payment SDK code entirely.

[Official CDP facilitator source](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/src/x402/facilitator.ts) and [authentication documentation](https://docs.cdp.coinbase.com/api-reference/v2/authentication) support the proposed composition. Keep the same CDP host and supported/verify/settle operation semantics, with request-specific server-only JWTs and bounded validated responses. Do not read credentials or issue tokens until separately authorized. No status/idempotency API is invented.

**Owner decision:** approve or reject implementing this narrow authentication/client composition within the existing provider architecture. It reduces reachable code, but still installs CDP's vulnerable dependencies. A clean installed graph still needs patched upstream parent releases or separately approved SDK/dependency removal and an officially documented HTTP/auth implementation with its own compatibility/security review. Moving dependencies to dev-only or changing audit scope is not remediation. No SDK was removed/replaced here.

The invalid exploratory query `npm view @coinbase/cdp-sdk/auth` returned ENOENT because npm treated the subpath as a filesystem package; the supported export was verified from the real package manifest/source instead. This is not evidence that the export fails to bundle.

## Remaining production authority and safety gates

This task implements the locally testable **pre-admission** chain, durable checkpoint and receipt consistency boundary. It does not implement an approved production receipt writer. Remaining requirements are concrete:

- Server/operator authority, approved source provenance, genuine per-resource finalized registry admission and immutable manifest/revocation ledger. Current confirmation-blocking triggers remain intact. A deployed contract, registry RPC observation or D1 flag is insufficient.
- Approved RPC trust/finality/freshness/clock/reorg policy and genuine native-USDC evidence, including actual CDP transaction construction compatibility. The observer conservatively supports direct-USDC calls; router/multicall compatibility is not claimed.
- Reviewed production evidence/receipt schema and atomic admission, independent reconciliation and conflict resolution policy. Existing 0007 only permits local provenance. No public/operator route that can promote a fixture exists.
- Supported dependency remediation. Candidate import isolation cannot turn the failing installed audit into PASS.
- Production D1 primary/session consistency, backups, migration rollout, abuse/rate limits, redacted monitoring and paid-but-unfulfilled recovery policy. Local D1 serialization is not production cross-region proof.
- The fixed internal handler remains the only pilot delivery model. No new fetch, DNS, proxy, service binding or hosting provider is introduced. Arbitrary merchant upstreams stay denied.

There is no exactly-once guarantee across D1, facilitator and HTTP delivery. No local deadline proves a submitted payment failed. Revocation cannot undo a submitted settlement or recall delivered bytes. Paid receipts remain durable, uncertain results stay unresolved until evidence resolves them, and no automatic second charge/refund is added.

## Exact unresolved finality/recovery decisions — non-executing proposal

Two production integration limits must not be mistaken for configuration-only work:

- The existing review journal compares the full canonical observation. Even legitimate movement to a newer finalized anchor currently produces a conservative conflict when the prior payload differs. Fixtures intentionally keep their finalized anchor stable. A production refresh policy must distinguish immutable transaction/authorization/receipt-block identity from monotonic finality checkpoints, require canonical revalidation, quarantine regressions or contradictory receipt blocks, and never automatically clear existing conflicts. That source/finality policy is not yet approved or implemented for production.
- Real Base finalized settlement cannot be assumed to complete within the local pilot's one-second evidence deadline. An unfinalized receipt must remain pending/unknown, not become a successful receipt or trigger resubmission. The current unknown attempt stores authorization identity/fingerprint but does not provide a production durable journal for an SDK-reported transaction hash before independent finality proof. Losing that transient report would complicate recovery. Local fixture ledger survival is not a solution to this production gap.

The proposed minimal extension, subject to owner review, is an append-only **untrusted facilitator-report** ledger after 0008: attempt/merchant/resource, authorization key/fingerprint, server operation/provider identity, reported transaction hash/disposition and timestamp, with explicit `facilitator_report_only` provenance and no receipt authority. Retain conflicting reports, forbid replacement/deletion, and bind later independent finalized evidence to the immutable report/attempt. This is a schema proposal, not a new migration/table implemented here. No raw signature, bearer payload or credentials should be stored.

Approve whether the first live pilot uses an explicit pending response and later read-only reconciliation/original-ticket retry, potentially with an owner-controlled internal review operation. Verify x402 client expectations for that flow before publishing it. Do not add a polling transfer retry, invent a CDP status endpoint or silently replace finalized proof with a weaker head/SDK response. Existing D1 can retain the state; no new service/provider is proposed. Production receipt/manifest authority and its atomic commit still require separate implementation and review after those decisions. These are engineering blockers before a real payment, not merely missing credentials.

## Smallest next decision for one owner-approved Base payment

Review the narrow public-auth/HTTP-client proposal and production admission/revocation/evidence authority policy together. Approve the exact restricted resource/handler, merchant/owner/payout/atomic amount/configuration, trusted RPC/finality/clock, pending/finalized recovery flow and forward-schema plan before further production integration. Resolve the dependency gate through supported remediation; a live test is not a vulnerability fix.

After the remaining code/security gates pass, separately approve owner-managed credentials, migration/publication/rollback, genuine resource registration, buyer/merchant identities, exactly one test and explicit maximum USDC/ETH/provider spending/time limits. No amounts, balances, transaction hashes, source verification or successful Mainnet payments are invented here. More integration work remains after policy review; a credential or deployment command is not the only remaining step.

## Exact files changed in this continuation

- `server/sg07/settlement-admission.ts` (new)
- `server/sg07/settlement-evidence.ts`
- `server/sg05/store.ts`
- `tests/sg05/chain-verifier.ts`
- `tests/sg05/handler.ts`
- `tests/sg05/run.mjs`
- `tests/sg03/run.mjs`
- `tests/sg06/run.mjs`
- `tests/registry-admission/run.mjs`
- `tests/release-security/run.mjs`
- `migrations/0008_sg07_settlement_journal_integrity.sql` (new)
- `scripts/cdp-auth-boundary.mjs` (new)
- `package.json` (scripts only; dependencies unchanged)
- `docs/SG-07_SETTLEMENT_ADMISSION_REPORT.md` (new)
- `docs/SG-07_INTERNAL_PILOT_ADMISSION_REPORT.md`
- `docs/SG-07_REMEDIATION_REPORT.md`
- `docs/RELEASE_CHECKLIST.md`

All prior dirty source/reports and archives remain. No frontend, production routing, deployment configuration, contract/compiler or historical migration changes were made.

## Actual verification results

Final aggregate: **479 application checks**, including **188 payment lifecycle checks**, all passed (16 new groups over 463/172). The dedicated **20-check** admission run includes setup/isolation plus the new cases; it is a subset, not additional coverage counted twice. The older internal-pilot cases remain in the default full suite. `--admission-only` skips them only for focused development.

| Command                                                       | Exit | Evidence                                                                                                                                        |
| ------------------------------------------------------------- | ---- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run test:settlement-admission`                           | 0    | 20 native workerd/D1 checks; 0 duplicate settlement initiations and 0 upstream HTTP requests                                                    |
| `npm test` — final run                                        | 0    | 479 = 17 foundation + 14 compatibility + 14 SG-03 + 188 SG-05 + 20 SG-06 + 75 SG-07 + 43 registry admission + 32 upstream + 76 release security |
| `npm run test:release-security` after expectation correction  | 0    | 76 checks                                                                                                                                       |
| `npm run build`                                               | 0    | TypeScript/Vite                                                                                                                                 |
| `npm run lint`                                                | 0    | ESLint                                                                                                                                          |
| `npm run format:check`                                        | 0    | Prettier                                                                                                                                        |
| `npm run build:functions`                                     | 0    | Native Pages Functions compiled                                                                                                                 |
| `npm run check:bundle-boundary`                               | 0    | 463 public Functions inputs / 1,781 browser inputs, two chunks; no payment/test SDK, Zod or minimatch inputs                                    |
| `npm run check:cdp-auth-boundary`                             | 0    | 220 isolated candidate inputs; patched Zod 4.6.7 only; no SVM/Solana/Zod 3; no JWT or credentials used                                          |
| `forge fmt --check`, `forge build`, `forge test -vvv`         | 0    | 47 passed, 0 failed/skipped; existing contract/compiler unchanged                                                                               |
| Local migration helper twice on a fresh owned temporary state | 0    | All eight applied; repeat reports already applied with checksums verified; temporary state removed                                              |
| SHA-256 verification of migrations 0001–0007                  | 0    | All seven unchanged                                                                                                                             |
| `npm audit`, JSON equivalent                                  | 1    | 5 high + 12 moderate affected entries (two root advisories propagated through the graph)                                                        |
| `npm audit --omit=dev`, JSON equivalent                       | 1    | 5 high affected entries                                                                                                                         |
| `npm ls` affected dependencies                                | 0    | Installed graph valid, unresolved versions retained                                                                                             |
| `git diff --check`, `git status --short`                      | 0    | Whitespace clean; all work remains local/uncommitted                                                                                            |

Failure history is retained rather than hidden. An initial TypeScript check exited 2 after helper extraction lost nullable-field narrowing; explicit runtime checks corrected it. The replacement regression exited 1 before the forward fix, proving the journal gap. The first 0008 draft application exited 1 with local HTTP 500 due to the missing trigger marker; that un-applied draft was corrected. The first full aggregate exited 1 after 403 successful checks because one latest-migration assertion still expected 0007; it now correctly expects 0008. The corrected 76-check suite passed, followed by the final full aggregate above. No security assertion was weakened or audit failure suppressed.

The full run includes actual local health/authentication/merchant isolation, browser responsiveness, registry admission/quarantine, revocation, independent evidence negatives, payment replay/concurrency/restart/recovery and public route isolation. The dedicated run's actual mock counts were supported 14, verify 14, settle 14, reconcile 22, chain fixture 22, upstream 0; these are simulation counters, not usage or revenue. Native ordinary Functions reject forged payment/admission/auth-boundary paths and local flags. Existing Vite worker_threads and Foundry naming/cast/efficiency warnings are non-fatal and unchanged.

Evidence logs are ignored `.wrangler/admission-architecture-*` artifacts, including the intentional replacement reproduction, initial aggregate failure, final regression, targeted pass, standalone migration repeat, audit text/JSON and isolated auth metafile. None is a real Mainnet receipt or security certification.

**Final status: local components ready for owner review; production readiness BLOCKED; owner policy/authorization required.** No Git mutation, deployment, remote D1/Cloudflare/DNS change, live RPC/CDP/upstream call, production signing, blockchain broadcast, ETH/USDC spending, Builder Code or SG-08 work occurred. Stop for owner/ChatGPT review.
