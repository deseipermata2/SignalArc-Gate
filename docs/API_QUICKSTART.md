# API and agent quickstart

These are the implemented native Pages APIs. **Public x402 payment settlement is disabled.** Use the local Pages origin printed by `npm run pages:dev`; no deployed endpoint or merchant data is assumed here.

## Start and authenticate

Follow [onboarding](ONBOARDING.md) and the local migration instructions in [ENVIRONMENT.md](ENVIRONMENT.md). Open `/manage`, connect an injected EOA wallet, select Base Mainnet and sign the server-created SIWE challenge. Connecting alone does not authenticate.

The application obtains `POST /api/auth/nonce` with `{address, chainId: 8453}`, signs the exact returned message using the wallet provider, then submits `{message, signature}` to `POST /api/auth/verify`. Do not construct a replacement message/domain or supply a private key. Nonces expire after five minutes and are atomically consumed once; sessions expire after eight hours. See SG-03 evidence for the cryptographic and race tests.

Session authority resides in an HttpOnly cookie. Never copy it into scripts, localStorage, logs or documentation. Browser examples below use the same-origin session automatically. Cross-origin CORS access is not granted. Server-to-server agent authentication/delegation is **not implemented**; a connected agent does not inherit a merchant identity from a supplied wallet address.

## Read the actual session and resources

Run this only in the signed-in browser's console on your local application:

```js
const session = await fetch('/api/auth/session', {
  credentials: 'same-origin',
  cache: 'no-store',
}).then((r) => r.json())
if (!session.authenticated) throw new Error('Sign in through /manage first')

const resources = await fetch('/api/resources', {
  credentials: 'same-origin',
  cache: 'no-store',
}).then((r) => r.json())
console.log(resources.resources)
```

Resource values are your persisted settings, not sample production endpoints. Be mindful that resource reads contain your private upstream URL; do not paste them into public logs.

## Create and manage a resource

The `/manage` form is the recommended interface. Price input is decimal USDC with at most six fractional digits; the API stores canonical integer atomic strings. `1` atomic unit is 0.000001 USDC. Allowed range: `1`–`999999999999` atomic units.

A same-origin API mutation requires `Content-Type: application/json`, `X-SignalArc-Request: 1`, the exact Origin header supplied by the browser and a valid session cookie. The server derives merchant ownership; no client merchant ID is accepted.

This **local configuration-only** example prompts for your actual HTTPS JSON API URL and uses your authenticated wallet as payout. It does not fetch the URL or enable payments:

```js
const upstreamUrl = window.prompt('Enter your own HTTPS JSON API URL')
if (!upstreamUrl) throw new Error('No resource URL supplied')
const response = await fetch('/api/resources', {
  method: 'POST',
  credentials: 'same-origin',
  headers: { 'Content-Type': 'application/json', 'X-SignalArc-Request': '1' },
  body: JSON.stringify({
    name: 'My API',
    upstreamUrl,
    priceAtomic: '1000',
    payoutAddress: session.merchant.walletAddress,
    network: 'eip155:8453',
    enabled: true,
    responseConfig: { type: 'json', maxBytes: 65536, redirects: 'error' },
  }),
})
if (!response.ok)
  throw new Error(
    'Resource registration rejected; check the form/API requirements',
  )
const created = (await response.json()).resource
```

That example configures 0.001 USDC; it is not a payment or a production price recommendation. Choose your own persisted price/payout intentionally. Payout is not proof of ownership and changing it does not transfer merchant access.

| Method      | Implemented route         | Behavior                                                            |
| ----------- | ------------------------- | ------------------------------------------------------------------- |
| GET         | `/api/health`             | Liveness only; Base target, not payment/registry readiness          |
| GET         | `/api/auth/session`       | Server authentication status; no session token                      |
| POST        | `/api/auth/logout`        | JSON `{}`; revoke session and clear cookies                         |
| GET / POST  | `/api/resources`          | Owned list / configuration creation                                 |
| GET / PATCH | `/api/resources/{id}`     | Owned detail / supported configuration fields                       |
| DELETE      | `/api/resources/{id}`     | JSON `{}`; soft-disable, not hard delete                            |
| GET         | `/api/reporting/summary`  | Owned attempt/receipt aggregate and provenance availability         |
| GET         | `/api/reporting/attempts` | Bounded owned attempt history                                       |
| GET         | `/api/reporting/receipts` | Bounded owned receipt history with unverified proof fields redacted |

Use only a real `id` returned by your resource API. PATCH supports name, URL, price, payout, response config, network and enabled fields. Ownership is checked on every operation. Other merchants receive 404 for your resource. Saving does not change the registry; enabling is configuration state only.

## Reporting filters and exact amounts

```js
const report = await fetch('/api/reporting/summary?source=all', {
  credentials: 'same-origin',
  cache: 'no-store',
}).then((r) => r.json())
console.log(report)
```

Common filters: `source=all|local_simulation|unverified|verified`, `resourceId` from your owned resources, and optional `from`/`to` UTC calendar dates in `YYYY-MM-DD`. Dates are inclusive; default is the last 30 UTC calendar days. Maximum window is 90 days, ending no later than today. Invalid, repeated or unsupported filters return 422. A foreign resource filter returns 404.

Attempts additionally accept `phase` from the SG-05 lifecycle. List routes accept `limit` (1–50, default 20) and the returned opaque `cursor`. Keep merchant, route and filters unchanged when paging. Cursor positions are not credentials. Summary is not phase-filtered; receipt time determines receipt totals, attempt creation time determines attempt counts. Refresh restarts an evolving history; pagination is not a cross-request database snapshot.

Currency totals are decimal **atomic strings**, not floating-point values. Use BigInt or a six-decimal formatter. SQL sums are cast to text before returning to JavaScript. Overflow/query failures return a sanitized 503; narrow the reporting range instead of treating an error as zero.

`verified.available` is currently false and its totals are null. The current schema lacks an approved production confirmation/admission pipeline. Even a self-declared `confirmed_onchain` label is quarantined as unverified; `source=verified` admits no records. This does not prove no external transfer happened. It means this application has no admitted proof to report.

Consistent local receipt records are identified as LOCAL SIMULATION ONLY. Other records appear as unverified, with receipt amount/reference withheld. Counts describe persisted attempts and receipts, not measured API calls, unique customers, revenue or actual Mainnet volume. Receipts are counted once per attempt; analytics event retries are not used as financial evidence.

## x402 / agent integration boundary

Target protocol: x402 **v2**, exact EVM/EIP-3009, Base Mainnet `eip155:8453`, native USDC `0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913`.

The isolated SG-05 test flow is unpaid request → 402 `PAYMENT-REQUIRED` → client `PAYMENT-SIGNATURE` → facilitator verify → settle → durable receipt → protected JSON with `PAYMENT-RESPONSE`. It uses upfront settlement. Standard original-URL retries and issued-ticket URLs are tested. This is a protocol overview, **not a public payment endpoint**.

Reproduce only through:

```sh
npm run test:compatibility
npm run test:sg05
```

Those commands create and destroy loopback fixtures. Successful settlement, registry observation, upstream and clock capabilities are explicitly local simulations. Do not configure a buyer signer, real CDP key, funded wallet or public `/sg05/*` route. The normal application's router does not expose them.

Never interpret verification alone, a transaction-shaped string, client `PAYMENT-RESPONSE`, pending/unknown state or simulation receipt as real settlement. An unknown outcome requires authoritative reconciliation; do not automatically retry settlement or request another authorization. A settled payment can still fail delivery. The server guarantees one durable settlement initiator/release claim, not exactly-once network delivery, a refund or proof the client received bytes. EIP-3009 signs financial authorization fields, not HTTP URLs/configuration versions; bearer-header confidentiality and intent policy still need production review.

Errors: 401 requires signing in again; 403 indicates origin/CSRF restrictions; 404 does not establish whether another merchant owns an ID; 413/414 indicates size limits; 422 invalid configuration/filter; 503 unavailable database/configuration/reporting. Do not log cookies, SIWE signatures, raw payment headers, credentials or private upstream configuration when diagnosing failures.
