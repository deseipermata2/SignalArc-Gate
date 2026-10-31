import { GatewayError } from './bounds'
/** Server-owned clock capability. The local fixture supplies its own loopback clock; callers cannot. */
export type TrustedClock = () => Promise<number>
export async function clockTime(read: TrustedClock): Promise<number> {
  const now = await read()
  if (!Number.isSafeInteger(now) || now <= 0)
    throw new GatewayError(503, 'trusted_clock_unavailable')
  return now
}
