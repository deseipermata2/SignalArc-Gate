import { useState } from 'react'
import { Button } from '@/components/ui/button'
export default function RegistryStatus({
  resourceId,
}: {
  resourceId?: string
}) {
  const [status, setStatus] = useState<Record<string, unknown> | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  async function refresh() {
    setBusy(true)
    setError('')
    setStatus(null)
    try {
      const response = await fetch(
        '/api/registry' +
          (resourceId ? '?resourceId=' + encodeURIComponent(resourceId) : ''),
        {
          credentials: 'same-origin',
          cache: 'no-store',
          signal: AbortSignal.timeout(7000),
        },
      )
      if (!response.ok)
        throw Error(
          response.status === 401
            ? 'Sign in again to read registry status.'
            : 'Registry status is unavailable.',
        )
      setStatus(await response.json())
    } catch (e) {
      setError(
        e instanceof Error ? e.message : 'Registry status is unavailable.',
      )
    } finally {
      setBusy(false)
    }
  }
  return (
    <section
      aria-label="EndpointRegistry status"
      className="space-y-2 rounded-lg border p-3 text-sm"
    >
      <p className="font-medium">Base Mainnet EndpointRegistry</p>
      <Button variant="outline" disabled={busy} onClick={() => void refresh()}>
        {busy
          ? 'Reading registry…'
          : resourceId
            ? 'Read resource registry status'
            : 'Read deployed registry status'}
      </Button>
      {error && <p role="alert">{error}</p>}
      {status && (
        <div role="status" className="space-y-2">
          <p className="break-all">Contract: {String(status.address)}</p>
          <p>
            Deployment: owner-verified. Explorer source verification:
            unverified.
          </p>
          <p>Runtime observation: {String(status.runtimeObservation)}</p>
          {resourceId && (
            <p>
              Resource: {String(status.resourceStatus)}. This does not admit
              registration for payments.
            </p>
          )}
          {status.reason && <p>{String(status.reason)}</p>}
          <p>Production payments remain disabled.</p>
        </div>
      )}
    </section>
  )
}
