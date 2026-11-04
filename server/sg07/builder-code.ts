import { canonical } from '../sg05/bounds'
import {
  declareBuilderCodeExtension,
  BUILDER_CODE_PATTERN,
  MAX_CLIENT_SERVICE_CODES,
} from '@x402/extensions/builder-code'

/** Owner-supplied public project identifier; not a secret or payment authority. */
export const SIGNALARC_BUILDER_CODE = 'bc_ipzfx50y'

/**
 * SDK-supported application declaration (Schema 2, role a).
 * Used by the isolated gateway; production integration remains gated. Never
 * injected into signed authorizations. Only the facilitator can suffix its tx.
 */
export function signalArcBuilderDeclaration(chainId: number) {
  if (chainId !== 8453)
    throw new Error('Builder attribution requires Base Mainnet')
  return { 'builder-code': declareBuilderCodeExtension(SIGNALARC_BUILDER_CODE) }
}

/** Validate optional, untrusted envelope metadata; never rewrite authorization/signature. */
export function validSignalArcBuilderEcho(value: unknown): boolean {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false
  const extensions = value as Record<string, unknown>
  if (Object.keys(extensions).join(',') !== 'builder-code') return false
  const entry = extensions['builder-code']
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) return false
  const e = entry as Record<string, unknown>
  if (
    !Object.hasOwn(e, 'info') ||
    Object.keys(e).some((k) => !['info', 'schema'].includes(k))
  )
    return false
  if (!e.info || typeof e.info !== 'object' || Array.isArray(e.info))
    return false
  const info = e.info as Record<string, unknown>
  if (
    info.a !== SIGNALARC_BUILDER_CODE ||
    Object.keys(info).some((k) => !['a', 's'].includes(k))
  )
    return false
  if (
    info.s !== undefined &&
    (!Array.isArray(info.s) ||
      info.s.length > MAX_CLIENT_SERVICE_CODES ||
      info.s.some(
        (code) => typeof code !== 'string' || !BUILDER_CODE_PATTERN.test(code),
      ))
  )
    return false
  // Canonical key order is handled by the existing bounded parser's canonical serializer.
  if (
    e.schema !== undefined &&
    canonical(e.schema) !==
      canonical(declareBuilderCodeExtension(SIGNALARC_BUILDER_CODE).schema)
  )
    return false
  return true
}
