# SG-04 — EndpointRegistry Smart Contract Implementation

Status: **IN PROGRESS — local implementation ready for owner/ChatGPT review.** The owner has approved SG-00 through SG-03. This work does not mark SG-04 complete, change a roadmap checklist, or implement SG-05.

## Initial inspection and preserved work

Working directory: `/home/deseti213/projects/signalarc-gate`; branch `main`; HEAD `9a74569` (`feat: complete SG-03 wallet SIWE and D1 resource management`). Initially only `SG-02-review.tar.gz` and `SG-03-review.tar.gz` were untracked. Neither archive was modified, deleted, staged or unpacked.

Inspected repository structure, configuration, SG-03 report/environment documentation, D1 migration, resource validators, merchant authorization, existing tests and the empty `contracts/src`, `contracts/test`, `contracts/script` directories. No applicable local AGENTS.md or canonical V2 roadmap/project-rules file was found; the owner's prompt supplies the governing SG-04 requirements. The SG-03 report is historical evidence, not edited to retroactively change its original review status.

SG-03 ownership is based on the server-verified merchant session, not a client payout address. `api_resources.id` is a server-generated UUID; `merchant_id` joins to `merchants.wallet_address`; `price_atomic` is a positive canonical decimal integer string of at most 12 digits. Upstream URLs and JSON settings are offchain configuration, and disabling is reversible configuration state. The contract mirrors these boundaries without changing any API, D1 schema, frontend, session code, x402 code, dependency version or CI workflow.

## Files created or modified

Created:

- `contracts/foundry.toml`
- `contracts/src/EndpointRegistry.sol`
- `contracts/test/TestSupport.sol`
- `contracts/test/EndpointRegistry.t.sol`
- `contracts/test/EndpointRegistry.invariant.t.sol`
- `docs/SG-04_REPORT.md`

Modified only `.gitignore` and `.prettierignore`, narrowly excluding Foundry generated output/cache/broadcast artifacts; `.gas-snapshot` is also Git-ignored. Solidity formatting uses `forge fmt`. No npm/Solidity library dependency, Git submodule, deployment script, funded wallet configuration, environment file or production address was added. The existing empty script directory remains unused.

## Toolchain and reproducibility

Already installed tools, no installation performed:

- Forge, Cast, Anvil: **1.5.1-stable**, commit `b0a9dd9ceda36f63e2326ce530c10e6916f4b8a2`, build timestamp `2025-12-22T11:39:01.425730780Z`.
- Solidity: **0.8.28+commit.7893614a.Linux.g++**, existing compiler in the owner's SVM cache.
- Foundry configuration: compiler exactly 0.8.28, offline mode, automatic compiler detection disabled, Cancun EVM, chain ID **8453**, legacy code generation (`via_ir = false`), optimizer 200 runs with **Yul optimization explicitly disabled**. No compiler download is needed on this machine.
- Fuzz: 512 runs per test, seed `0x8453`. Invariants: 128 runs, depth 64, `fail_on_revert = true`. No RPC endpoint or fork configured. All execution uses Forge's local in-process EVM, not Anvil broadcasting or a public chain.

Run Foundry commands from `contracts/`:

```sh
forge --version
forge fmt --check
forge build
forge test -vvv
forge test --gas-report
forge test --match-contract EndpointRegistryGasTest --gas-report
forge inspect EndpointRegistry storageLayout --json
```

`TestSupport.sol` declares only the official cheatcodes actually used and small real assertion helpers. Forge's native `targetContracts()` discovery targets the stateful handler; forge-std and Git-mutating installers are unnecessary. A different machine needs compatible Foundry and the pinned compiler installed by its owner. Offline mode deliberately fails rather than silently downloading a different compiler. No system-level tool installation was attempted.

## Contract architecture and storage

The immutable, permissionless registry stores authorization and public payment configuration, not custody or proof of payment. There is no administrator, upgrade proxy, delegate call, token integration, settlement logic, balance accounting, enumeration loop, payable method, receive/fallback handler or external call. The constructor rejects creation unless the local/network chain ID is 8453. Ordinary calls that attach ETH or use unknown selectors revert.

One private mapping at storage slot 0 maps `bytes32 resourceId` to:

| Relative slot | Members and byte offsets                                              |
| ------------- | --------------------------------------------------------------------- |
| 0             | `owner: address` at 0; `version: uint64` at 20; `enabled: bool` at 28 |
| 1             | `payout: address` at 0; `priceAtomic: uint96` at 20                   |
| 2             | `configHash: bytes32` at 0                                            |
| 3             | `pendingOwner: address` at 0                                          |

Solidity's emitted storage layout confirms 128 bytes/four slots per entry at `keccak256(abi.encode(resourceId, uint256(0)))`. Constants consume no storage. Initially three slots have nonzero content; the pending-owner slot is reserved and becomes nonzero on nomination. Existing ownership is the existence sentinel, so disabling never releases the identifier. Packing owner/version/enabled and payout/price reduces occupied slots; individual field writes require masking/read-modify-write. No private merchant ID, name, upstream URL, authentication record, signature or credential is stored.

USDC prices use `uint96` atomic units, with a strict range **1–999999999999**, matching SG-03 (0.000001–999999.999999 USDC). There is no floating-point math or onchain decimal conversion. Payout and owner must be nonzero. An opaque configuration commitment must be nonzero. The registry cannot inspect a hash preimage or prove a registered API exists, responds with JSON, or is safe to fetch.

### Public interface, events and errors

Constants: `CHAIN_ID()`, `MAX_PRICE_ATOMIC()`, `RESOURCE_ID_DOMAIN()`.

| Method                                                            | Behavior                                                                                            |
| ----------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| `deriveResourceId(address originalOwner, bytes16 d1ResourceId)`   | Pure deterministic owner-namespaced ID; rejects zero owner/UUID                                     |
| `register(bytes16,address,address,uint96,bytes32,bool)`           | Caller must equal supplied owner; validates values, rejects existing ID, creates version 1          |
| `getResource(bytes32)`                                            | Returns the complete typed struct; missing ID reverts                                               |
| `updateConfiguration(bytes32,uint64,address,uint96,bytes32,bool)` | Current owner and exact expected version required; changes payout/price/hash/enabled; rejects no-op |
| `disable(bytes32,uint64)`                                         | Current owner soft-disables; repeated disable reverts                                               |
| `transferOwnership(bytes32,uint64,address)`                       | Current owner nominates/replaces a distinct nonzero pending owner                                   |
| `cancelOwnershipTransfer(bytes32,uint64)`                         | Current owner clears an existing nomination                                                         |
| `acceptOwnership(bytes32,uint64)`                                 | Only nominated owner accepts the current version; clears nomination                                 |

Every successful mutation increments version exactly once, including nomination/cancellation/acceptance. A checked uint64 overflow reverts without partial changes; a boundary test injects that state locally. Reverted/no-op/unauthorized/stale calls do not change state or emit events. Stale version checks guard all owner mutations and acceptance, preventing a signer from silently applying an operation to changed configuration.

Disable is reversible only through explicit owner `updateConfiguration(..., true)`, consistent with SG-03. Read/update/transfer remain available while disabled. A transfer never changes resource ID, payout, price, hash or enabled state. Pending owners have no configuration privileges. Current owners can cancel/replace a nomination; there is no transfer to zero, ownership renunciation, automatic expiry or privileged recovery. Acceptance requires reviewing the latest version, particularly if payout/configuration changed during nomination.

Events, with resource ID and participating owners indexed: `ResourceRegistered` (also indexed UUID), `ConfigurationUpdated`, `ResourceDisabled`, `OwnershipTransferStarted`, `OwnershipTransferCancelled`, `OwnershipTransferred`. Configuration events include full public configuration/version; transfer/disable events include the resulting version. Exact emitter, topics and data are tested.

Custom errors: `UnsupportedChain(uint256)`, `ZeroAddress()`, `InvalidResourceId()`, `InvalidPrice(uint96)`, `InvalidConfigHash()`, `AlreadyRegistered(bytes32)`, `ResourceNotFound(bytes32)`, `Unauthorized()`, `VersionMismatch(uint64,uint64)`, `NoConfigurationChange()`, `AlreadyDisabled()`, `InvalidNewOwner()`, `NoPendingTransfer()`.

## Deterministic onchain/offchain mapping

### Resource identity

1. Parse the existing canonical D1 UUID by removing its hyphens and decoding its 32 hex digits to **bytes16**, preserving byte order. Do not hash the textual UUID or parse it as a JavaScript floating-point number. Contract validation requires nonzero bytes16; UUID version/format validation remains an application responsibility.
2. Let `originalOwner` be `merchants.wallet_address` at the original registration, not the payout address or merchant's opaque D1 ID.
3. Use standard Solidity ABI encoding, not packed encoding:

```text
resourceId = keccak256(abi.encode(
  keccak256(bytes("SignalArcGate.Resource.v1")),
  uint256(8453), address(originalOwner), bytes16(uuidBytes)
))
```

The owner namespace prevents an unrelated wallet from preempting another merchant's resource ID: registration requires `msg.sender == owner`. The same UUID under another wallet yields a different ID, not control over the legitimate resource. Duplicate registration in the same original-owner namespace always reverts, including after disabling or ownership transfer. Keccak collision resistance is assumed; this is not a mathematical collision-free encoding.

The complete future binding is **chain 8453 + approved registry contract address + resourceId**, with originalOwner retained. IDs do not include a deployment address; a future consumer must pin the reviewed canonical registry address rather than trust an arbitrary registry. After transfer, do not rederive the ID from the new owner.

### Configuration commitment v1

The proposed deterministic preimage format for a future consumer is:

```text
configHash = keccak256(abi.encode(
  keccak256(bytes("SignalArcGate.EndpointConfig.v1")),
  bytes32(resourceId),
  keccak256(UTF8(canonicalUpstreamUrl)),
  uint8(1),             // supported response type: JSON
  uint32(maxBytes),     // existing validated range 1024..1048576
  uint8(0),             // redirects policy: error; no following
  bytes32(salt)
))
```

`canonicalUpstreamUrl` is the exact persisted URL produced by the existing SG-03 WHATWG URL normalization (`new URL(value).href`), without extra trimming, case folding or JSON serialization. The salt is a per-resource, offchain-only 32-byte random value in a future implementation; never publish its preimage or upstream URL in transaction calldata/events. The public constant salt below is **test data only**. Salting protects low-entropy URL commitments from simple dictionary comparison but is not encryption; anyone who learns the preimage can recompute it. Hash preimage validation and salt storage/synchronization are not implemented in SG-04.

Price, payout, owner, enabled, pending owner and version are separately readable authoritative fields, not hidden inside this hash. Display name and local timestamps are not committed. This avoids ambiguous JSON serialization and unnecessary disclosure. Changing a committed field requires a new commitment; changing any registry state requires a new version even if the commitment stays the same.

Cross-language vector, independently calculated with existing viem 2.57.13 and asserted in Solidity:

| Input/output                | Value                                                                |
| --------------------------- | -------------------------------------------------------------------- |
| D1 UUID                     | `8dc286d7-8b04-4411-96a0-422aad965f31`                               |
| Original owner              | `0x00000000000000000000000000000000000a11ce`                         |
| Resource ID                 | `0x8cceed2c37972681854cf4182a58d3364ae687fb42eb43f5907be00ff2928412` |
| Local vector URL            | `https://api.example.com/v1/data` (never fetched)                    |
| JSON / maxBytes / redirects | `1 / 65536 / 0`                                                      |
| Public test salt            | `0x1111111111111111111111111111111111111111111111111111111111111111` |
| Configuration hash          | `0xe21af1340a6f9664cc72f413627d5b14dd7e44a37ecb3cdc868014badf58594d` |

### Authority and mismatch handling for future phases

| D1 value                                  | Registry equivalent / authority                                                           |
| ----------------------------------------- | ----------------------------------------------------------------------------------------- |
| `api_resources.id`                        | UUID bytes + original owner determine ID; retain immutable binding after transfer         |
| `merchant_id -> merchants.wallet_address` | Local CRUD authority only; must match current onchain owner before future paid routing    |
| `payout_address`                          | Compare address bytes with onchain `payout`; payout never establishes ownership           |
| `price_atomic`                            | Compare exact BigInt/decimal integer with onchain `priceAtomic`; no floats                |
| `upstream_url`, `response_config`         | Local preimage; recomputed commitment must equal `configHash`                             |
| `enabled`                                 | Local routing deny switch plus onchain enabled state; require both enabled and consistent |
| `updated_at`                              | Local timestamp only, not an onchain version                                              |
| Network                                   | D1 `eip155:8453`, registry constant 8453; reject mismatches                               |

D1 currently has **no** canonical registry binding, original-registration owner, salt, observed version, transaction or confirmation metadata. Do not pretend those fields already exist. A separately approved integration must persist them and read a consistent onchain snapshot at an agreed block/finality level, verify the pinned registry/code and current owner, compare all fields/commitment/version, and fail closed on missing binding, pending transfer, stale/unknown state or mismatch. Reorg handling and confirmation depth are future design requirements, not tested synchronization.

An accepted onchain transfer deliberately leaves SG-03 D1 merchant ownership unchanged. Freeze future paid routing on the owner mismatch until a separately authorized resource-level rebinding policy is implemented. Never rewrite a merchant's wallet or transfer all its other resources/sessions automatically. A D1 edit/enable is not an onchain update; an event alone is not proof of current state or payment. No such reconciliation, RPC reader, signer, UI transaction, payment parser or settlement service was added here.

## Actual verification results

| Command / check                                       | Result                                                                             |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| `forge --version`                                     | PASS, installed 1.5.1-stable                                                       |
| `forge fmt --check`                                   | PASS                                                                               |
| `forge build`                                         | PASS, Solidity 0.8.28, final reviewed compiler settings                            |
| `forge test -vvv`                                     | **47 passed, 0 failed, 0 skipped**                                                 |
| `forge test --gas-report`                             | **47 passed**, gas report produced                                                 |
| Isolated successful-call gas suite                    | **3 passed**, measurements below                                                   |
| `forge inspect EndpointRegistry storageLayout --json` | PASS, four-slot layout confirmed                                                   |
| Compiled runtime opcode inspection                    | PASS, no CALL/CALLCODE/DELEGATECALL/STATICCALL/CREATE/CREATE2/SELFDESTRUCT opcodes |
| `npm run build`                                       | PASS, original application preserved                                               |
| `npm run lint`                                        | PASS                                                                               |
| `npm run format:check`                                | PASS                                                                               |
| `npm run test:foundation`                             | **17 passed**, includes real local D1 read/write, health and browser checks        |
| `npm run test:compatibility`                          | **14 passed**, Foundation/CDP local workerd compatibility preserved                |
| `npm run test:sg03`                                   | **14 passed**, local native Pages/D1 authentication/CRUD/browser flow preserved    |
| `npm run build:functions`                             | PASS                                                                               |
| `git diff --check`                                    | PASS                                                                               |
| `git status --short`                                  | Only listed SG-04 files and the two pre-existing untracked archives                |

The 47 Foundry tests comprise **35 deterministic unit tests, 5 fuzz tests, 3 gas tests and 4 stateful invariants**. Each fuzz test runs 512 generated cases; some invalid/irrelevant identifier or attacker inputs return early and are not counted as successful registrations. Boundaries are covered by separate explicit tests. Fuzzing covers valid/out-of-range atomic prices, identifiers/ABI encoding/owner namespaces, unauthorized update callers and stale versions.

Each invariant passed 128 runs × 64 handler calls = **8192 calls**, with zero unexpected handler reverts/discards. The four properties use the same seeded campaign; do not interpret this as 32768 distinct randomized scenarios. The handler models owner/configuration/pending owner/enabled/version independently, caps the domain to 12 distinct owner/UUID pairs, and mixes register, update, disable, nominate, accept, cancel, spoofed/unauthorized operations, stale writes and rejected ETH transfers. Setup explicitly exercises every transition and each unauthorized mutation selector before randomization. Expected target reverts are caught and asserted, rather than hidden by `fail_on_revert = false`.

Properties: every full resource equals the independent authorized-state model; configuration remains bounded/nonzero with a valid owner; the sum of all versions equals exactly the successful state-change count; ordinary calls accept/distribute no ETH. The non-custody invariant does not claim the EVM can prohibit forced ETH or unsolicited token transfers.

Tests also cover exact events, missing reads, duplicate preservation after disable/transfer, invalid configuration, initial disabled registration, explicit re-enable, transfer replacement/cancellation, old-owner revocation, payout preservation, stale acceptance, read-only static calls, zero/maximum price, no-nomination acceptance even with a zero local caller, version overflow rollback and absence of events on rejection. No wallet key or signed public transaction was needed for contract tests; callers are local cheatcode impersonations, not real wallet authorization or Mainnet execution.

Development observations: an initial root-directory Forge invocation reported `Nothing to compile` and was not counted as contract proof; all reported contract checks ran from `contracts/`. Early file-write commands used the wrong relative prefix and failed before writing; corrected paths were then compiled/tested. Storage inspection initially failed because the cache lacked `storageLayout`; requesting that compiler output fixed the issue and the final inspection passed. Final contract tests have no failures.

Nonfatal diagnostics remain: Foundry recommends assembly hashing/naming conventions and warns about test-only uint160/uint128 casts bounded by modulo 3/4; no production truncating cast is used. High-level ABI hashing is retained for auditability. Vite retains SG-03's unused `ox/tempo` `node:worker_threads` browser-externalization warning; actual local browser checks pass. No warning was suppressed to claim a clean security audit.

## Local gas analysis

Final settings above, **not Base Mainnet receipts or cost quotations**. The full security report mixes reverts, fuzzing and invariant calls, so successful-call measurements use:

```sh
forge test --match-contract EndpointRegistryGasTest --gas-report
```

| Forge-reported metric                                 | Local gas units |
| ----------------------------------------------------- | --------------: |
| Estimated deployment cost                             |      **955984** |
| Register, fresh ID                                    |       **97763** |
| Update payout + price + commitment, enabled unchanged |       **43947** |
| Disable, enabled to disabled                          |       **30611** |
| Read complete configuration                           |       **10316** |

Successful registration is sampled four times (three setup calls and one separate fresh-ID call), update/disable once each; min/average/median/max agree within each row. These are profiler rows, not test-body totals. Gas tests snapshot existing setup state before updates/disabling and assert resulting configuration. Creation bytecode is **4239 bytes**, deployed runtime **4172 bytes**. Different addresses/calldata bytes, cold/warm accesses, write transitions, refunds, compiler settings and future chain gas rules can change measurements. No live gas price, fiat conversion or exact fee promise is supplied.

Storage dominates fresh registration: three nonzero value slots plus a zero pending-owner slot; updates rewrite the packed payout/price and hash slots plus version in owner slot; disable changes only the packed owner/version/enabled slot. Nomination adds a nonzero pending-owner slot; acceptance/cancellation clears it subject to normal gas/refund rules. No storage arrays or dynamic strings are written.

For an eventual transaction, use actual estimated/receipt gas, not blindly these local rows:

```text
executionFeeETH = gasUsed * effectiveGasPriceWei / 10^18
               = gasUsed * effectiveGasPriceGwei / 10^9
totalBaseFeeETH = (gasUsed * effectiveGasPriceWei + l1DataFeeWei + operatorFeeWei) / 10^18
```

Deployment likewise needs creation/intrinsic/calldata accounting and Base fee components. Base's official fee documentation describes execution, L1 data/security and applicable operator fees; none was queried onchain here. Local gas units alone cannot establish the real ETH cost.

## Security review, residual risks and owner decisions

- **Authorization:** only original owner registers in its namespace; only current owner updates/disables/nominates/cancels; only pending owner accepts. Payout confers no privileges. All mutation versions are checked. No relayed signature/meta-transaction path exists.
- **Reentrancy/external behavior:** no external calls or transfers, confirmed in source and disassembled runtime. No reentrancy guard/dependency is needed for this interface. Adding external interactions later requires fresh review.
- **Non-custody:** no receive/escrow/transfer/settlement code. The EVM cannot prevent someone forcing ETH into an address or an ERC-20 contract assigning it tokens; such assets have no recovery route and no user balance/withdrawal rights. Do not send funds to the registry or configure it as a payout recipient. This is not a custody or receipt contract.
- **Ownership operations:** no admin recovery for lost owner keys or mistakenly accepted transfers. Two-step acceptance prevents accidental unilateral loss but does not validate a recipient's operational suitability. Contract wallet callers can interact directly, while SG-03's SIWE frontend still supports only EOAs.
- **Configuration/availability:** hashes are commitments, not validation of private URLs, DNS safety, API availability or payments. Malicious registrants can publish arbitrary nonzero commitments in their own namespace. Future routing must recompute/compare the trusted preimage and enforce all SG-03 validation plus deferred SSRF protections.
- **Immutability:** no upgrades, global pause, list of trusted merchants, fees or administrator. An approved future replacement requires a new address and explicit consumer migration. No deployment address is configured or invented.
- **Compiler:** 0.8.28 was already installed, not selected as the latest production compiler. Current official bug data was reviewed: SOL-2026-7 is gated off by `yul = false`; SOL-2026-6/-4/-2/-1 require IR codegen, disabled here. SOL-2026-5 requires deleting memory byte-array elements and SOL-2025-1 requires clearing/copying storage arrays across slot overflow; neither construct exists in the registry. These are source/settings-based exclusions, not an independent proof of compiler correctness. Before public deployment, the owner should approve testing a current patched compiler and repeat review/gas/code validation; no system compiler was installed here.
- **Application dependency risk:** GHSA-mrhx-c7xc-m3w5 remains an unresolved Zod dependency/release concern. Application dependencies and audit configuration were not modified, repaired, overridden or suppressed. Registry tests do not resolve it.

No implementation blocker remains for this local SG-04 scope. Owner review must approve the ID/commitment format, immutable/no-admin design, reversible disable, exact price cap and two-step transfer behavior before future integration. Public compiler/toolchain approval, deployment, transaction signing/broadcasting, real registry binding and reconciliation require separate owner authorization; none is performed here. SG-05 remains unstarted.

No Git mutation, public deployment, remote D1 operation, Cloudflare/DNS operation, public testnet use, blockchain transaction broadcast, ETH/USDC spending, paid service, secret collection or unrelated repository modification occurred. This is local test evidence, **not Mainnet execution or an independent security audit**.

## Official sources consulted

- [Foundry configuration](https://www.getfoundry.sh/config/index.html), [invariant testing](https://getfoundry.sh/forge/invariant-testing/), [gas tracking](https://getfoundry.sh/forge/gas-tracking/). Markdown source was read directly when the browser tool could not render its content type; installed 1.5.1 behavior and effective configuration were verified locally rather than assuming current documentation matches every old-tool feature.
- [Solidity 0.8.28 storage layout](https://docs.soliditylang.org/en/v0.8.28/internals/layout_in_storage.html), [ABI encoding](https://docs.soliditylang.org/en/v0.8.28/abi-spec.html), [security considerations](https://docs.soliditylang.org/en/v0.8.30/security-considerations.html).
- [Current Solidity compiler bug list](https://docs.soliditylang.org/en/latest/bugs.html), [official machine-readable bug data](https://github.com/ethereum/solidity/blob/develop/docs/bugs.json). Reviewed against exact installed compiler/options and registry constructs.
- [Base network fee calculation](https://docs.base.org/specifications/transactions/network-fees). No current fee/price value is adopted as a quotation.
