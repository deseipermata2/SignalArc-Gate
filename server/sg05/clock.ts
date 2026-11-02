import { GatewayError } from './bounds'
/** Server-owned clock capability. The local fixture supplies its own loopback clock; callers cannot. */
export type TrustedClock = () => Promise<number>
export async function clockTime(read: TrustedClock): Promise<number> {
  const now = await read()
  if (!Number.isSafeInteger(now) || now <= 0)
    throw new GatewayError(503, 'trusted_clock_unavailable')
  return now
}
/** Payment-operation watermark only; does not change existing registry/upstream clock contracts. */
export function monotonicClock(read: TrustedClock): TrustedClock {
  let last = 0
  return async () => {
    const now = await clockTime(read)
    if (now < last) throw new GatewayError(503, 'trusted_clock_unavailable')
    last = now
    return now
  }
}
