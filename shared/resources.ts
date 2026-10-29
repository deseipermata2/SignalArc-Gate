import { getAddress, isAddress } from 'viem'

export class ValidationError extends Error {}
export interface ResponseConfig {
  type: 'json'
  maxBytes: number
  redirects: 'error'
}
export interface ResourceInput {
  name: string
  upstreamUrl: string
  priceAtomic: string
  payoutAddress: string
  responseConfig: ResponseConfig
  network: 'eip155:8453'
  enabled: boolean
}
export interface Resource extends ResourceInput {
  id: string
  createdAt: number
  updatedAt: number
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ValidationError('Expected a JSON object')
  return value as Record<string, unknown>
}
export function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key)))
    throw new ValidationError('Unsupported field')
}
export function walletAddress(value: unknown) {
  if (
    typeof value !== 'string' ||
    !isAddress(value, { strict: true }) ||
    /^0x0{40}$/i.test(value)
  )
    throw new ValidationError('A valid nonzero Ethereum address is required')
  return getAddress(value)
}
function hasControl(value: string) {
  return Array.from(value).some(
    (char) => char.charCodeAt(0) < 32 || char.charCodeAt(0) === 127,
  )
}
export function httpsUpstream(value: unknown) {
  if (
    typeof value !== 'string' ||
    value.length > 2048 ||
    value !== value.trim() ||
    /[\s\\]/.test(value) ||
    hasControl(value)
  )
    throw new ValidationError('A valid HTTPS upstream URL is required')
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new ValidationError('Malformed HTTPS URL')
  }
  if (
    !value.startsWith('https://') ||
    url.protocol !== 'https:' ||
    url.username ||
    url.password ||
    value.slice('https://'.length).split(/[/?#]/)[0].includes('@') ||
    url.port ||
    value.includes('#')
  )
    throw new ValidationError(
      'HTTPS URLs must use port 443 without credentials or fragments',
    )
  // Conservative hostname-only registration. All IP literals (including public IPs)
  // and special-use names are rejected. DNS is not resolved and no fetch is made.
  const labels = url.hostname.toLowerCase().split('.')
  if (
    labels.length < 2 ||
    url.hostname.length > 253 ||
    !/^[a-z]{2,63}$/.test(labels.at(-1) ?? '') ||
    labels.some(
      (label) => !/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label),
    ) ||
    /(?:^|\.)(?:localhost|localdomain|local|internal|lan|home|test|invalid|example|onion|arpa)$/.test(
      url.hostname,
    )
  )
    throw new ValidationError(
      'Upstream must be a public DNS hostname; local, reserved names and IP addresses are forbidden',
    )
  return url.href
}
export function usdcToAtomic(input: string) {
  if (!/^(?:0|[1-9]\d{0,5})(?:\.\d{1,6})?$/.test(input))
    throw new ValidationError(
      'Use a positive USDC amount with at most six decimal places',
    )
  const [whole, fraction = ''] = input.split('.')
  const amount = BigInt(whole) * 1_000_000n + BigInt(fraction.padEnd(6, '0'))
  if (amount < 1n || amount > 999_999_999_999n)
    throw new ValidationError('USDC price is outside the supported range')
  return amount.toString()
}
export function atomicToUsdc(atomic: string) {
  const value = BigInt(atomic)
  const fraction = (value % 1_000_000n)
    .toString()
    .padStart(6, '0')
    .replace(/0+$/, '')
  return `${value / 1_000_000n}${fraction ? `.${fraction}` : ''}`
}
export const resourceFields = [
  'name',
  'upstreamUrl',
  'priceAtomic',
  'payoutAddress',
  'responseConfig',
  'network',
  'enabled',
]
export function resourceInput(value: unknown): ResourceInput {
  const data = object(value)
  keys(data, resourceFields)
  if (
    typeof data.name !== 'string' ||
    data.name.trim().length < 1 ||
    data.name.trim().length > 80 ||
    hasControl(data.name)
  )
    throw new ValidationError('Name must contain 1–80 characters')
  if (
    typeof data.priceAtomic !== 'string' ||
    !/^[1-9]\d{0,11}$/.test(data.priceAtomic)
  )
    throw new ValidationError(
      'priceAtomic must be a positive integer string of at most 12 digits',
    )
  if (data.network !== 'eip155:8453')
    throw new ValidationError('Only eip155:8453 is supported')
  if (typeof data.enabled !== 'boolean')
    throw new ValidationError('enabled must be a boolean')
  const response = object(data.responseConfig)
  keys(response, ['type', 'maxBytes', 'redirects'])
  if (
    response.type !== 'json' ||
    response.redirects !== 'error' ||
    typeof response.maxBytes !== 'number' ||
    !Number.isInteger(response.maxBytes) ||
    response.maxBytes < 1024 ||
    response.maxBytes > 1048576
  )
    throw new ValidationError(
      'JSON response requires type json, redirects error and maxBytes between 1024 and 1048576',
    )
  return {
    name: data.name.trim(),
    upstreamUrl: httpsUpstream(data.upstreamUrl),
    priceAtomic: data.priceAtomic,
    payoutAddress: walletAddress(data.payoutAddress),
    network: 'eip155:8453',
    enabled: data.enabled,
    responseConfig: {
      type: 'json',
      maxBytes: response.maxBytes,
      redirects: 'error',
    },
  }
}
