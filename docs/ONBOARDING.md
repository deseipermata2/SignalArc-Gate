# Developer onboarding and privacy

SignalArc Gate is a Base-native x402 API monetization gateway. Today it supports local merchant configuration, authenticated reporting, contract tests and isolated payment-lifecycle tests. **It is not deployed or approved for public payments by this work.** Read [release blockers](RELEASE_CHECKLIST.md) before planning any launch.

## Prepare the local application

Use the repository's locked packages and Node 22.22.2:

```sh
npm ci
npm run build
npm run db:migrate:local
npm run pages:dev
```

The helper applies all forward migrations, including SG-06 query indexes, to ignored local disk state under `.wrangler/state`. It verifies existing digests and has no remote option. `--persist-to <local directory>` selects isolated migration state. Tests select their own temporary database. Never invent a production D1 UUID or use remote migrations for local onboarding.

Open the actual loopback URL printed by Pages. `/api/health` should return HTTP 200 with service SignalArc Gate, network base-mainnet and chain 8453; that proves liveness only. The frontend-only Vite server does not supply native Pages APIs. Use Pages dev for SIWE, D1 and reporting.

## Connect and sign in

1. Open `/manage` using a compatible injected EVM wallet. Keep keys/seed phrases in the wallet, never in this app or a command line. Local automated tests use unfunded ephemeral accounts without exposing their keys.
2. The interface shows the connected wallet separately from the authenticated merchant. Wrong-network state prevents sign-in; switch explicitly to **Base Mainnet, 8453**. No public testnet or automatic transaction is involved.
3. Choose Sign in with Ethereum and inspect the expected local domain, Base chain and statement. Signing authenticates a server nonce; it authorizes no payment or transaction. Only EOA personal-sign signatures are supported currently.
4. The server verifies the signature, nonce/domain/origin/chain/expiry and atomically consumes the nonce, then sets an HttpOnly session cookie. Wallet connection state alone is not authority.
5. Log out to invalidate the server session. Disconnect first logs out. The dashboard clears merchant caches on logout, expiry and unauthorized responses. If the connected wallet differs from the session identity, log out before authenticating another wallet.

HTTPS cookies use Secure, HttpOnly, SameSite=Strict, Path=/ and `__Host-` names. Only explicit loopback HTTP development has a non-Secure exception. No authentication token is returned to JavaScript or stored in localStorage. Real wallet-extension variants and deployed TLS behavior still need separate acceptance evidence.

## Configure a resource

Create an API resource with a meaningful name, your real HTTPS JSON upstream URL, exact USDC price, intentional payout address, JSON response byte limit and enabled state. Redirects are forbidden. The API accepts 1–999999999999 atomic USDC units; the form supports six decimal places. Your authenticated wallet establishes merchant ownership; payout can differ but does not grant that address access to your account.

The URL validator rejects unsafe schemes, authority credentials, non-443 ports, IP literals (including alternate/IPv6 forms), localhost, metadata/link-local and special-use names. It does **not** establish safe DNS resolution/connection behavior. Registration and edits only persist configuration and never fetch the upstream. No production proxy or safe outbound transport has been enabled.

The list displays your persisted price, payout, resource ID and status. Edit reads the actual resource first; Disable persists a soft-disable. Enabled configuration does not mean onchain registration or public paid fulfillment. Registry synchronization and a genuine deployed address are still required and not invented by this task.

## Understand payment records

The dashboard reads only your merchant's attempts/receipts with bounded pagination, UTC date windows, resource/source filters and phase filtering. Loading, empty, unauthorized and error states correspond to real API requests.

- **Local simulation:** internal test records. These are not Mainnet transfers or real revenue. Simulation receipt totals never enter verified metrics, and local references are not linked to an explorer.
- **Unverified provenance:** legacy, inconsistent or insufficiently substantiated records. Proof-sensitive fields are withheld; a database label alone cannot admit a real settlement.
- **Pending/unknown:** no fulfillment permission. Unknown may mean a transfer was submitted despite a lost response; authoritative reconciliation is required before another payment action.
- **Settlement reported / failed delivery:** settlement and delivery are separate. Paid-but-unfulfilled records require incident handling; there is no automatic charge, refund or replay of protected content.
- **Verified Mainnet:** unavailable until an approved evidence admission pipeline exists. Null totals mean unavailable, not a fabricated zero or proof about external blockchain activity.

No payment rows are inserted during ordinary onboarding or migrations. With no records, the dashboard shows an honest empty state. Tests insert explicitly local fixtures into isolated databases only.

## Non-custodial and privacy boundaries

The registry stores public owner/payout/atomic-price/commitment/version/status information; it never receives, escrows, swaps or transfers merchant funds or settles x402. Future payments are intended to go directly to the server-authoritative merchant payout. No gateway balance or custody wallet exists. Funds forced/sent directly to an immutable contract can be unrecoverable; never send assets to the registry.

D1 stores wallet identities, resource configuration (including private upstream URLs), canonical SIWE challenges, hashed session/challenge tokens and payment metadata/fingerprints. A canonical SIWE challenge contains its nonce text; do not incorrectly assume all nonce-related text is absent from storage. Raw payment signatures/authorizations are not persisted by SG-05. Reporting omits upstream configuration, authorization hashes, session tokens and internal settlement payloads.

Do not publish API output containing your private upstream URL or copy authentication/payment headers into logs. Static and authenticated API security headers restrict framing/referrers/content sources; they are defense in depth, not an audit. SIWE challenge issuance has D1-based limits, but broad production ingress/read/concurrency/storage abuse controls and retention policies remain unverified. Free-tier daily quotas are not security rate limits.

The dependency audit remains visibly failing; partial remediation does not authorize public payment parsing. Review [API details](API_QUICKSTART.md), [environment](ENVIRONMENT.md), [SG-06 evidence](SG-06_REPORT.md) and the [launch approval packet](RELEASE_CHECKLIST.md). No Git mutation, public deployment, DNS change, funded-wallet action or live settlement is part of onboarding verification performed by Codex.
