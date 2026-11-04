# SignalArc Gate Builder Code integration

**Code:** `bc_ipzfx50y` (owner supplied). **Network:** Base Mainnet, chain 8453 only.

**Verdict:** local SDK/server integration is implemented and tested. Hosted CDP support is explicitly documented; it is not an identified unsupported-facilitator blocker. Actual hosted execution and onchain attribution remain unverified. Production payments remain disabled under the existing SG-07 release gates. This is not grant approval or evidence of attributed activity.

## Official sources and verified support

Reviewed on 2026-11-05:

- [Base Builder Codes overview](https://docs.base.org/specifications/builder-codes/overview).
- [Base app developer integration](https://docs.base.org/specifications/builder-codes/for-app-developers): Wagmi writes need per-call suffixes; a `createConfig` suffix does not reach connected injected-wallet writes.
- [ERC-8021 text linked by Base](https://eip.tools/eip/8021): schema identifiers, trailing marker and transaction/user-operation placement. The usual eips.ethereum.org URL returned 404 here; no claim about final standards status is made.
- [Official x402 Builder Code specification](https://github.com/x402-foundation/x402/blob/main/specs/extensions/builder_code.md): x402 uses Schema 2 CBOR; application `a`, facilitator/wallet `w`, client/service `s` and facilitator-authored metadata `m` have distinct roles.
- [Official CDP Facilitator documentation](https://docs.cdp.coinbase.com/x402/seller/facilitator), **Supported extensions**: explicitly documents `builder-code` on EVM settlements and facilitator construction of ERC-8021 Schema 2 calldata.
- [Coinbase SDK README](https://github.com/coinbase/cdp-sdk/blob/main/typescript/packages/cdp-sdk/README.md): server `builderCode` declares application attribution, while client codes occupy service attribution. Checked against installed CDP 1.60.0 and Foundation extensions/core/EVM 2.29.0 exports/types/source.

No live supported endpoint, credentials, code-registry lookup or transaction was used. The project's code registration/ownership is owner-provided information, not independently queried evidence. Documentation confirms capability, not that any SignalArc payment has been attributed.

## Transaction-path inspection

The current frontend connects injected wallets and performs SIWE message signing. It contains no `sendTransaction`, `writeContract`, `sendCalls` or raw transaction submission path. Registry observations and D1 merchant/resource CRUD do not send onchain transactions. The deployed EndpointRegistry is not modified or redeployed. Historical manual owner transactions cannot be retroactively attributed by an application change.

The isolated SG-05 gateway and SG-07 readiness adapter hand payments to a facilitator. SignalArc does not control that facilitator's transaction signer or calldata. Therefore:

- No suffix was added to SIWE messages, EIP-3009 authorizations, signatures, payment fingerprints or resource commitments.
- No global Wagmi configuration suffix or new transaction UI was introduced merely to claim integration.
- Only server-owned x402 extension metadata is declared. The actual sender/facilitator remains responsible for appending transaction calldata.
- Future app-owned wallet writes need an explicitly reviewed per-call suffix/capability; this task creates no such write path.

## Implemented local integration

`server/sg07/builder-code.ts` holds the public code and declares it through official `declareBuilderCodeExtension` as **application `a`**. The factory rejects non-8453 configuration. It does not claim the project's code as the facilitator's `w`, introduce a wallet, generate a signature or submit a transaction.

The existing local protocol registers the official resource-server extension. Both initial and repeated-ticket HTTP 402 responses advertise the same server declaration. The incoming bounded payment parser now accepts an optional Builder Code echo with the exact application code, only known extension/info keys, optional unchanged SDK schema and at most five syntactically valid client service codes. Client-supplied facilitator codes, arbitrary metadata, changed application codes, changed schemas and other extensions remain rejected. Missing attribution remains backward compatible with existing local clients.

Validation reads envelope metadata; it does not rewrite it or any signed authorization. The original payload is forwarded to the existing facilitator client. Amount/payee/network/asset/issued-ticket comparisons, expiration, fingerprint/nonce identity, replay, settlement claims, uncertainty, receipts, manifest/revocation, independent evidence and fulfillment safeguards remain in force. Attribution is never payment proof or a receipt-admission bypass.

The local mock transaction sender uses official `BuilderCodeFacilitatorExtension` to build and append the suffix when it receives the declaration. The integration test checks the app code and `cdp_sdk_client` service code in that synthetic calldata. The independent USDC calldata/signature/receipt verifier still validates the simulated payment with the suffix present. No real transaction/hash or Mainnet attribution is inferred from this test.

An additional native workerd format probe verifies the Schema 2 single-app vector:

```text
0xa161616b62635f69707a6678353079000f0280218021802180218021802180218021
```

This encodes CBOR `{a:"bc_ipzfx50y"}`, 15 CBOR bytes, schema 2 and the 16-byte ERC marker. Real facilitator calldata may additionally include its own wallet code, services and permitted metadata, so its complete suffix need not equal this minimal vector. The format probe has no signing or network capability and uses an explicitly invalid unsigned sentinel solely to prove the suffix helper does not mutate authorization fields. It never verifies/settles that sentinel or returns payment success.

All new probe routes exist only in isolated temporary local Pages Functions. The normal production router is unchanged. `test:builder-code` is added to the normal test chain for future CI coverage. No dependency versions/lockfile, D1 migrations, production configuration or contract source changed.

## Remaining checks before claiming live attribution

After existing payment security gates and separate owner authorization are satisfied:

1. Verify the configured CDP facilitator's actual supported extension/capability response and deployed integration behavior. Do not infer observed capability from a documentation page alone.
2. Use the approved server declaration and compatible client echo before any authorization is signed. Do not patch an existing authorization or append bytes to a signature.
3. Allow only the facilitator to construct/broadcast the settlement transaction under the separately approved payment budget.
4. Independently verify the genuine Base receipt/events/authorization/finality and inspect the resulting calldata's Schema 2 suffix for `a=bc_ipzfx50y`. A hash or suffix alone is not payment proof.
5. Confirm any Base Dashboard attribution/registration independently before reporting activity, rewards or volume.

These are non-executing review steps. No credential values, wallet identities, spending amounts or transaction evidence are invented. Existing dependency, production admission, finality/recovery and upstream restrictions remain blockers to public payments; this task does not clear them.

A truthful grant statement is: “SignalArc Gate configures Builder Code bc_ipzfx50y through the official x402 Builder Code extension. CDP documents EVM settlement support. Local format, payload-preservation and payment-flow tests pass; live Mainnet attribution has not yet been performed.”

## Exact files changed in this task

- `server/sg07/builder-code.ts` (new)
- `server/sg05/protocol.ts`
- `server/sg05/gateway.ts`
- `tests/builder-code/handler.ts` (new)
- `tests/builder-code/run.mjs` (new)
- `tests/builder-code/tsconfig.json` (new)
- `tests/sg05/chain-fixture.mjs`
- `tests/sg05/run.mjs`
- `package.json` (scripts only)
- `docs/BUILDER_CODE_INTEGRATION.md` (new)
- `docs/RELEASE_CHECKLIST.md`
- `docs/SG-07_REMEDIATION_REPORT.md`

HEAD remains `6af7855` on `wip/sg07-remediation-20261102`. Previous uncommitted SG-07 work and twelve archives were preserved. No applicable AGENTS.md/canonical V2 files were found; no official phase status was changed. Earlier “Builder Code deferred/no Builder Code work” report sections are historical and superseded only for this explicitly authorized local task.

## Actual verification

| Command                             | Exit | Actual result                                                                                                       |
| ----------------------------------- | ---- | ------------------------------------------------------------------------------------------------------------------- |
| `npm run test:builder-code`         | 0    | 8 native workerd format/policy/isolation checks                                                                     |
| `npm run test:settlement-admission` | 0    | 24 focused payment/admission checks, including the four new attribution groups; subset of the full payment suite    |
| `npm run test:sg05`                 | 0    | 192 local workerd/D1 payment checks, 0 duplicate settlement initiations                                             |
| `npm run test:sg07`                 | 0    | 75 readiness/facilitator/registry/security checks                                                                   |
| `npm run build`                     | 0    | TypeScript/Vite build                                                                                               |
| `npm run lint`                      | 0    | ESLint                                                                                                              |
| `npm run format:check`              | 0    | Prettier                                                                                                            |
| `npm run build:functions`           | 0    | Native Pages Functions compiled                                                                                     |
| `npm run check:bundle-boundary`     | 0    | 463 Functions inputs / 1,781 browser inputs, two chunks; no payment/test SDK/Zod/minimatch inputs in public bundles |
| `git diff --check`                  | 0    | Whitespace clean                                                                                                    |

The focused payment run recorded 15 local simulated settlement calls and **zero upstream HTTP calls**, with no duplicate initiations. The full payment regression also exercises 25 pre-existing loopback upstream mock requests; these are not live upstream connections or production activity. New attribution cases verify declaration/retry consistency, SDK sender suffix parsing, unchanged authorization/signature data, and rejection of wrong application, extra extensions and forged facilitator identity before verification/settlement.

An earlier broad focused run during implementation failed an existing concurrent-revocation assertion (`revoked=0`, expected 1); it ran while source changes were still being made. No protected success was observed, but that failure's exact runtime cause was not independently isolated. The final stabilized full 192-check run passed the same assertion unchanged. The failed log is retained at ignored `.wrangler/builder-code-payment.log`; final evidence is in `builder-code-payment-full.log`, `builder-code-payment-targeted.log`, `builder-code-targeted.log`, `builder-code-sg07.log` and build/lint/format/Functions/bundle logs. No assertion was relaxed to conceal the earlier result.

The entire unrelated application aggregate and Foundry suite were not repeated in this bounded attribution task; no contract changed. The new eight-check suite is appended to the existing aggregate script for subsequent CI runs. Dependency audits were not rerun because versions and lockfile are unchanged; the latest prior report's 5 high/12 moderate full and 5 high production findings remain unresolved, not newly rescanned or fixed here.

No Git mutation, signing/broadcasting of a transaction, live CDP call, deployment, remote D1 operation, DNS change, funds spent or public payment activation occurred. Local payment tests reuse isolated unfunded offchain EIP-712 authorization fixtures only. No production wallet or credentials were requested. Stop for owner review; SG-07 remains IN PROGRESS.
