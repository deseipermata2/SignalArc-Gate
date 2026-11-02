# SG-07 manual WSL contract release procedure — NON-EXECUTING

**BLOCKED pending owner/ChatGPT review and separate execution approval.** This is a preparation document, not a deployment script or launch authorization. No command involving a real provider, hardware wallet, explorer, deployment or broadcast was executed by Codex. SG-07 stays IN PROGRESS. Review the [comprehensive remediation report](SG-07_REMEDIATION_REPORT.md) and [release record](CONTRACT_RELEASE.json). Deploying the registry alone will not make payments operational or safe.

## Local preparation (no wallet or network needed)

From the repository root in WSL:

```bash
npm ci
npm run check:contract-release
npm run check:bundle-boundary
npm test
npm run build
npm run lint
npm run format:check
npm run build:functions
npm audit
npm audit --omit=dev
cd contracts
forge fmt --check
forge build --sizes
forge test -vvv
forge test --gas-report
```

Audit failures are mandatory findings, not instructions to force fixes or bypass review. `check:contract-release` builds in a fresh isolated local directory and compares exact settings, source/configuration hashes, ABI, storage layout and bytecode hashes to the reviewed record. Regenerating that record does not approve its changes. Verify Forge 1.5.1 and the official Solidity **0.8.38+commit.1835d247** binary; Linux binary SHA-256 **65c3180a336eabb6bdc4bbd49cc405aeb233976964ae6c11fba2a6c8be8f3243**, checked against the official solc-bin manifest. A Windows/macOS binary has its own official checksum.

Exact settings: Cancun EVM, legacy codegen, optimizer enabled/runs 200, Yul optimization disabled, metadata bytecode hash none, no appended CBOR, no libraries or constructor arguments, Base chain 8453. Source pragma is exactly 0.8.38. Do not change settings or use a proxy/upgrade contract. The registry has no payable receiver, token transfer, settlement, admin or custody behavior.

Artifact identities:

- Runtime: **4,172 bytes**, raw-byte SHA-256 **ce6f21f57d87051c51ffbfb05330981574d1e516a932aa3b1a95cc6bed13ef45**.
- Runtime Ethereum Keccak-256: **0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df**. This is the code-hash value relevant to a future approved registry policy.
- The owner's **ebaf47794b9dd9041d96904ab79daab2ff765aec496df943ec6d482757f9d31f** is SHA-256 of the `0x` hex text **including a trailing newline**. It is not raw-byte SHA-256 or Ethereum Keccak. All three formats are explicitly recorded.
- Initcode: **4,239 bytes**; raw-byte SHA-256 **bffa7d779dc4b161506e4003864037f34ff1357303c58373b58ea124ea971726**. Verify it against the record, never a pasted unreviewed creation payload.
- Local Forge deployment measurement: **955,984 gas units**. This is not an ETH fee quotation, full public deployment gas estimate or a guarantee of current Base fees.

## Separate owner approval before any external action

Approve the exact source revision, compiler/binary/settings, release-record hash, ABI/storage design, immutable/no-rescue behavior, signer/deployer address, secure signer mechanism and trustworthy Base RPC. Never paste a private key, seed, passphrase or API credential into this repository, ChatGPT, command arguments, terminal history or logs. Do not create a funded account or new key as part of this guide. Use an owner-controlled secure signer that already exists; the example below requires an existing supported hardware wallet. If unavailable, stop and select/review a secure signer separately.

Approve maximum gas limit, max fee and priority fee, **total ETH spending cap including Base L1 data/operator fees**, time window and exactly one intended deployment. No amount, gas price or balance is guessed. Reestimate the exact initcode through the approved provider only after read-only external access is separately authorized. The constructor rejects other chain IDs, but that does not authenticate the provider or signing interface.

Use a credential-free approved RPC URL; if a provider requires a secret URL/header, stop and review a supported secure transport rather than placing credentials in CLI arguments.

The following is a **future owner-only template**, not an approved command. The variables are names for owner-approved values, not fabricated addresses or supplied secrets. Do not run until the preceding approvals are recorded:

```bash
set -u
: "${APPROVED_BASE_RPC:?approved trustworthy Base provider required}"
: "${APPROVED_DEPLOYER:?approved hardware-wallet address required}"
: "${APPROVED_GAS_LIMIT:?approved gas limit required}"
: "${APPROVED_MAX_FEE_WEI:?approved max fee required}"
: "${APPROVED_PRIORITY_FEE_WEI:?approved priority fee required}"
test "$(cast chain-id --rpc-url "$APPROVED_BASE_RPC")" = 8453
# Owner verifies the hardware display, creation payload, chain, sender and total budget first.
forge create src/EndpointRegistry.sol:EndpointRegistry \
  --rpc-url "$APPROVED_BASE_RPC" --chain 8453 \
  --ledger --from "$APPROVED_DEPLOYER" \
  --gas-limit "$APPROVED_GAS_LIMIT" --gas-price "$APPROVED_MAX_FEE_WEI" \
  --priority-gas-price "$APPROVED_PRIORITY_FEE_WEI" --broadcast
```

This template is unsuitable for an owner without that reviewed hardware signer. Never replace `--ledger` with a raw key argument. No wallet or budget has been approved by this work. Failed/uncertain submission requires evidence review before retry; a new broadcast needs explicit approval.

## Evidence and source verification after an approved deployment

Record the actual creation transaction, sender, receipt status, canonical block/hash/finality, address, exact runtime bytes/code hash, gas and full fees against approved caps. Check `CHAIN_ID()` is 8453 and deployed runtime bytes match the release record. A transaction hash or explorer URL alone is insufficient. Keep the gateway disabled.

With the genuine approved deployed address, produce standard JSON source input using the pinned build/settings (Foundry `forge verify-contract --show-standard-json-input`), inspect it locally, and submit source verification only after separate publication/verification approval. Use the exact compiler version/optimizer/Yul/EVM/metadata flags and empty constructor arguments; verification must not fall back to another compiler because bytecode happens to match. Owner supplies any required explorer credential through a secure supported mechanism; Codex requests no credential. Retain successful explorer/source verification and runtime evidence. Do not invent an address to prepare verification.

Approve the address/runtime-code hash/finality/provider policy only after these checks. No existing D1 row may be marked confirmed from an explorer URL or a local observation. Current production registry admission remains disabled. RPC provider trust, live CDP behavior, supported settlement transaction shape, independent receipt admission, operational recovery and connection-safe upstream transport still require further reviewed engineering/evidence. Approve any production D1 migration/publication separately; do not redeploy or redo the owner-verified domain setup merely to perform registry preparation.

## Recovery and costs

An immutable registry has no rollback/upgrade administrator. Stop on any mismatch; do not register paid resources against it. A replacement deployment would need new approval and spending budget. Never send ETH/USDC to the registry; forced assets have no admin rescue path. A frontend or DNS rollback cannot undo a deployment or transfer.

Fee planning uses observed values only: `executionGas × effectiveGasPriceWei + L1DataFeeWei + applicableOperatorFeeWei`, divided by `10^18` for ETH. Approve a total cap in addition to transaction fee fields; no exact cost is promised by a local gas report.
