import { recoverMessageAddress, type Hex } from 'viem'
import {
  createSiweMessage,
  parseSiweMessage,
  validateSiweMessage,
} from 'viem/siwe'
import { keys, object, walletAddress } from '../../shared/resources'
import {
  cookie,
  hash,
  HttpError,
  json,
  randomToken,
  readCookie,
  readJson,
  type ApiConfig,
} from './http'

const nonceLifetime = 5 * 60 * 1000
const sessionLifetime = 8 * 60 * 60 * 1000
export const signInStatement =
  'Sign in to SignalArc Gate. No transaction or payment is authorized.'
interface NonceRow {
  nonce_hash: string
  wallet_address: string
  browser_hash: string
  origin: string
  message: string
  issued_at: number
  expires_at: number
  consumed_at: number | null
}
export interface SessionRow {
  token_hash: string
  merchant_id: string
  wallet_address: string
  expires_at: number
}

export async function session(request: Request, config: ApiConfig) {
  const token = readCookie(request, config.cookieName)
  if (!token) return null
  return config.db
    .prepare(
      `SELECT s.token_hash, s.merchant_id, m.wallet_address, s.expires_at
    FROM sessions s JOIN merchants m ON m.id = s.merchant_id
    WHERE s.token_hash = ? AND s.origin = ? AND s.chain_id = ? AND s.revoked_at IS NULL AND s.expires_at > ?`,
    )
    .bind(await hash(token), config.origin, 8453, Date.now())
    .first<SessionRow>()
}
export async function requireSession(request: Request, config: ApiConfig) {
  const active = await session(request, config)
  if (!active) throw new HttpError(401, 'Sign in with Ethereum to continue')
  return active
}
export async function nonce(request: Request, config: ApiConfig) {
  const data = object(await readJson(request))
  keys(data, ['address', 'chainId'])
  if (data.chainId !== 8453)
    throw new HttpError(
      422,
      'Authentication requires Base Mainnet chain ID 8453',
    )
  const address = walletAddress(data.address)
  const now = Date.now(),
    expires = now + nonceLifetime
  const value = randomToken(),
    browser = randomToken()
  const message = createSiweMessage({
    address,
    chainId: 8453,
    domain: config.domain,
    uri: config.origin,
    nonce: value,
    version: '1',
    statement: signInStatement,
    issuedAt: new Date(now),
    expirationTime: new Date(expires),
  })
  const requester = await hash(
    `${config.origin}:${request.headers.get('CF-Connecting-IP') ?? 'local'}`,
  )
  const insert = config.db
    .prepare(
      `INSERT INTO auth_nonces
    (nonce_hash, wallet_address, browser_hash, requester_hash, origin, message, issued_at, expires_at)
    SELECT ?, ?, ?, ?, ?, ?, ?, ?
    WHERE (SELECT COUNT(*) FROM auth_nonces WHERE requester_hash = ? AND issued_at > ?) < 200
      AND (SELECT COUNT(*) FROM auth_nonces WHERE wallet_address = ? AND issued_at > ?) < 32`,
    )
    .bind(
      await hash(value),
      address.toLowerCase(),
      await hash(browser),
      requester,
      config.origin,
      message,
      now,
      expires,
      requester,
      now - nonceLifetime,
      address.toLowerCase(),
      now - nonceLifetime,
    )
  // Expired auth state is pruned opportunistically, without touching merchant data.
  const results = await config.db.batch([
    config.db.prepare('DELETE FROM sessions WHERE expires_at <= ?').bind(now),
    config.db
      .prepare('DELETE FROM auth_nonces WHERE expires_at <= ?')
      .bind(now),
    insert,
  ])
  if (results[2].meta.changes !== 1)
    throw new HttpError(429, 'Too many sign-in challenges; try again later')
  return json({ message, expiresAt: expires, chainId: 8453 }, 200, [
    cookie(config.challengeName, browser, nonceLifetime / 1000, config.secure),
  ])
}
export async function verify(request: Request, config: ApiConfig) {
  const data = object(await readJson(request))
  keys(data, ['message', 'signature'])
  if (typeof data.message !== 'string' || data.message.length > 4096)
    throw new HttpError(422, 'A bounded SIWE message is required')
  if (
    typeof data.signature !== 'string' ||
    !/^0x[0-9a-fA-F]{130}$/.test(data.signature)
  )
    throw new HttpError(
      422,
      'Only standard 65-byte EOA personal-sign signatures are supported; contract signatures are unsupported',
    )
  const message = parseSiweMessage(data.message)
  const now = Date.now()
  if (
    !message.address ||
    !message.nonce ||
    !/^[a-f0-9]{64}$/.test(message.nonce) ||
    message.chainId !== 8453 ||
    message.version !== '1' ||
    message.domain !== config.domain ||
    message.uri !== config.origin ||
    message.statement !== signInStatement ||
    !message.issuedAt ||
    message.issuedAt.getTime() > now + 30000 ||
    !message.expirationTime ||
    message.expirationTime.getTime() <= now ||
    !validateSiweMessage({
      message,
      domain: config.domain,
      time: new Date(now),
    })
  )
    throw new HttpError(401, 'Invalid or expired SIWE message')
  const address = walletAddress(message.address)
  const nonceHash = await hash(message.nonce)
  const challenge = readCookie(request, config.challengeName)
  if (!challenge)
    throw new HttpError(401, 'Sign-in challenge cookie is missing or invalid')
  const browserHash = await hash(challenge)
  const stored = await config.db
    .prepare('SELECT * FROM auth_nonces WHERE nonce_hash = ?')
    .bind(nonceHash)
    .first<NonceRow>()
  if (
    !stored ||
    stored.consumed_at !== null ||
    stored.expires_at <= now ||
    stored.origin !== config.origin ||
    stored.browser_hash !== browserHash ||
    stored.wallet_address !== address.toLowerCase() ||
    stored.message !== data.message ||
    message.expirationTime.getTime() !== stored.expires_at ||
    message.issuedAt.getTime() !== stored.issued_at
  )
    throw new HttpError(
      401,
      'Invalid, expired or already used sign-in challenge',
    )
  let signer: string
  try {
    signer = await recoverMessageAddress({
      message: data.message,
      signature: data.signature as Hex,
    })
  } catch {
    throw new HttpError(
      401,
      'Invalid EOA signature; contract signatures are unsupported',
    )
  }
  if (signer.toLowerCase() !== address.toLowerCase())
    throw new HttpError(
      401,
      'Signature does not match the SIWE wallet; contract signatures are unsupported',
    )
  const token = randomToken(),
    tokenHash = await hash(token),
    merchantId = crypto.randomUUID()
  const claimTime = Date.now()
  if (stored.expires_at <= claimTime)
    throw new HttpError(401, 'Sign-in challenge expired during verification')
  const expires = claimTime + sessionLifetime
  const oldToken = readCookie(request, config.cookieName)
  const oldHash = oldToken ? await hash(oldToken) : ''
  // D1 batch is a transaction. The random claim hash gates all dependent INSERTs.
  // A losing concurrent verifier cannot create a merchant or session.
  const results = await config.db.batch([
    config.db
      .prepare(
        `UPDATE auth_nonces SET consumed_at = ?, claim_session_hash = ?
      WHERE nonce_hash = ? AND consumed_at IS NULL AND expires_at > ? AND browser_hash = ? AND wallet_address = ? AND origin = ?`,
      )
      .bind(
        claimTime,
        tokenHash,
        nonceHash,
        claimTime,
        browserHash,
        address.toLowerCase(),
        config.origin,
      ),
    config.db
      .prepare(
        `INSERT INTO merchants (id, wallet_address, created_at, updated_at)
      SELECT ?, ?, ?, ? WHERE EXISTS (SELECT 1 FROM auth_nonces WHERE nonce_hash = ? AND claim_session_hash = ?)
      ON CONFLICT(wallet_address) DO NOTHING`,
      )
      .bind(
        merchantId,
        address.toLowerCase(),
        claimTime,
        claimTime,
        nonceHash,
        tokenHash,
      ),
    config.db
      .prepare(
        `INSERT INTO sessions (token_hash, merchant_id, origin, chain_id, created_at, expires_at)
      SELECT ?, id, ?, ?, ?, ? FROM merchants WHERE wallet_address = ?
      AND EXISTS (SELECT 1 FROM auth_nonces WHERE nonce_hash = ? AND claim_session_hash = ?)`,
      )
      .bind(
        tokenHash,
        config.origin,
        8453,
        claimTime,
        expires,
        address.toLowerCase(),
        nonceHash,
        tokenHash,
      ),
    config.db
      .prepare(
        `UPDATE sessions SET revoked_at = ? WHERE token_hash = ?
      AND EXISTS (SELECT 1 FROM auth_nonces WHERE nonce_hash = ? AND claim_session_hash = ?)`,
      )
      .bind(claimTime, oldHash, nonceHash, tokenHash),
  ])
  if (results[0].meta.changes !== 1 || results[2].meta.changes !== 1)
    throw new HttpError(401, 'Sign-in challenge has already been used')
  return json({ authenticated: true }, 200, [
    cookie(config.cookieName, token, sessionLifetime / 1000, config.secure),
    cookie(config.challengeName, '', 0, config.secure),
  ])
}
export async function currentSession(request: Request, config: ApiConfig) {
  const active = await session(request, config)
  // A stale concurrent status read must not clear a freshly issued login cookie.
  if (!active) return json({ authenticated: false })
  return json({
    authenticated: true,
    merchant: {
      id: active.merchant_id,
      walletAddress: walletAddress(active.wallet_address),
    },
    expiresAt: active.expires_at,
  })
}
export async function logout(request: Request, config: ApiConfig) {
  keys(object(await readJson(request)), [])
  const token = readCookie(request, config.cookieName)
  if (token)
    await config.db
      .prepare('UPDATE sessions SET revoked_at = ? WHERE token_hash = ?')
      .bind(Date.now(), await hash(token))
      .run()
  return json({ authenticated: false }, 200, [
    cookie(config.cookieName, '', 0, config.secure),
    cookie(config.challengeName, '', 0, config.secure),
  ])
}
