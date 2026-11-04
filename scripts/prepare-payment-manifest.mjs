// NON-EXECUTING owner review tool. Reads an owner-exported D1 snapshot; no DB/RPC/network access.
import { readFileSync } from 'node:fs'
import { getAddress, encodeAbiParameters, keccak256, toHex } from 'viem'
const file = process.argv[2]
if (process.argv.length !== 3 || !file)
  throw Error(
    'Usage: node scripts/prepare-payment-manifest.mjs <owner-reviewed-local-resource-snapshot.json>',
  )
const input = JSON.parse(readFileSync(file, 'utf8'))
const { resource: r, binding: b, merchant: m, expiresAt } = input
const now = Date.now(),
  expiry = Date.parse(expiresAt)
if (
  !r ||
  !b ||
  !m ||
  r.merchant_id !== m.id ||
  b.resource_id !== r.id ||
  r.enabled !== 1 ||
  r.network !== 'eip155:8453' ||
  !Number.isSafeInteger(r.payment_revision) ||
  !Number.isSafeInteger(b.generation) ||
  !Number.isSafeInteger(expiry) ||
  expiry <= now ||
  expiry > now + 30 * 86400000 ||
  !/^\d+$/.test(b.registry_version) ||
  BigInt(b.registry_version) < 1n ||
  BigInt(b.registry_version) > 2n ** 64n - 1n ||
  !/^\d+$/.test(r.price_atomic) ||
  BigInt(r.price_atomic) < 1n ||
  BigInt(r.price_atomic) > 999999999999n ||
  b.review_conflicted !== 0
)
  throw Error('Invalid, disabled or conflicted resource/expiry')
if (
  !/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(
    r.id,
  ) ||
  !/^0x[0-9a-f]{64}$/.test(b.config_salt)
)
  throw Error('Invalid immutable identity')
const owner = getAddress(m.wallet_address).toLowerCase(),
  original = getAddress(b.original_owner).toLowerCase(),
  recipient = getAddress(r.payout_address).toLowerCase()
if ([owner, original, recipient].some((a) => /^0x0{40}$/.test(a)))
  throw Error('Zero address')
const onchain = keccak256(
  encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'uint256' },
      { type: 'address' },
      { type: 'bytes16' },
    ],
    [
      keccak256(toHex('SignalArcGate.Resource.v1')),
      8453n,
      original,
      '0x' + r.id.replaceAll('-', ''),
    ],
  ),
)
const c = JSON.parse(r.response_config)
if (
  c.type !== 'json' ||
  c.redirects !== 'error' ||
  !Number.isSafeInteger(c.maxBytes) ||
  c.maxBytes < 1 ||
  c.maxBytes > 65536
)
  throw Error('Invalid JSON policy')
const commitment = keccak256(
  encodeAbiParameters(
    [
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'bytes32' },
      { type: 'uint8' },
      { type: 'uint32' },
      { type: 'uint8' },
      { type: 'bytes32' },
    ],
    [
      keccak256(toHex('SignalArcGate.EndpointConfig.v1')),
      onchain,
      keccak256(toHex(r.upstream_url)),
      1,
      c.maxBytes,
      0,
      b.config_salt,
    ],
  ),
)
const registry = '0xC4081a85935de1b9a929e5a6835d99471cd08c01',
  runtime = '0xaf2d51783c2f2d144c3913ed45661b328d1ef3661bb4db0668ec8568006d90df'
if (
  b.onchain_resource_id !== onchain ||
  b.config_hash !== commitment ||
  b.registry_address?.toLowerCase() !== registry.toLowerCase()
)
  throw Error('Binding/configuration mismatch')
const values = [
  r.id,
  m.id,
  'base-finalized-internal-json-v1',
  'signalarc.resource-configuration.v1',
  'operator_rpc',
  owner,
  original,
  onchain,
  registry,
  runtime,
  commitment,
  b.registry_version,
  r.payment_revision,
  b.generation,
  r.price_atomic,
  recipient,
  now,
  expiry,
  null,
]
const sql = (v) =>
  v === null
    ? 'NULL'
    : typeof v === 'number'
      ? String(v)
      : "'" + String(v).replaceAll("'", "''") + "'"
console.log(
  '-- NOT EXECUTED. Requires owner approval, registry registration/finality and migrations 0007–0009. No claim of chain observation or payment.',
)
console.log(
  '-- Review exact merchant, resource, payout, price and expiry. This one-use manifest cannot be replaced, renewed or unrevoked.',
)
console.log(
  'INSERT INTO payment_manifests VALUES(' + values.map(sql).join(',') + ');',
)
