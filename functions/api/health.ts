export function onRequestGet(): Response {
  return Response.json(
    {
      status: 'ok',
      service: 'SignalArc Gate',
      network: 'base-mainnet',
      chainId: 8453,
    },
    {
      headers: {
        'Cache-Control': 'no-store',
      },
    },
  )
}
