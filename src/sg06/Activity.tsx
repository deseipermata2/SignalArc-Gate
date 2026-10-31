import { useState, useEffect, type FormEvent } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { Button } from '@/components/ui/button'
import { Card, CardHeader, CardTitle, CardContent } from '@/components/ui/card'
import { atomicToUsdc, type Resource } from '../../shared/resources'
import {
  phaseLabels,
  paymentPhases,
  type AttemptReport,
  type ReceiptReport,
  type ReportPage,
  type ReportSource,
  type ReportSummary,
} from '../../shared/reporting'
interface Filters {
  source: ReportSource
  from: string
  to: string
  resourceId: string
}
const field = 'mt-1 w-full rounded-md border bg-background px-3 py-2 text-sm'
async function read<T>(path: string, signal: AbortSignal): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    signal: AbortSignal.any([signal, AbortSignal.timeout(10000)]),
  })
  const body = await response.json()
  if (!response.ok)
    throw new Error(
      response.status === 401
        ? 'Your session has expired. Sign in again.'
        : typeof body.error === 'string'
          ? body.error.slice(0, 256)
          : 'Reporting unavailable',
    )
  return body as T
}
function query(filters: Filters) {
  const q = new URLSearchParams({ source: filters.source })
  for (const key of ['from', 'to', 'resourceId'] as const)
    if (filters[key]) q.set(key, filters[key])
  return q
}
function time(ms: number) {
  return new Date(ms).toLocaleString(undefined, { timeZone: 'UTC' }) + ' UTC'
}
export default function Activity({
  merchantId,
  resources,
  onUnauthorized,
}: {
  merchantId: string
  resources: Resource[]
  onUnauthorized: () => void
}) {
  const client = useQueryClient()
  const [filters, setFilters] = useState<Filters>({
    source: 'all',
    from: '',
    to: '',
    resourceId: '',
  })
  const [draft, setDraft] = useState(filters)
  const [attemptCursor, setAttemptCursor] = useState<string[]>([]),
    [receiptCursor, setReceiptCursor] = useState<string[]>([])
  const [phase, setPhase] = useState('')
  const params = query(filters).toString()
  const summary = useQuery({
    queryKey: ['merchant-report', merchantId, 'summary', params],
    queryFn: ({ signal }) =>
      read<ReportSummary>(`/api/reporting/summary?${params}`, signal),
  })
  const a = query(filters)
  if (phase) a.set('phase', phase)
  if (attemptCursor.length) a.set('cursor', attemptCursor.at(-1)!)
  a.set('limit', '10')
  const p = query(filters)
  if (receiptCursor.length) p.set('cursor', receiptCursor.at(-1)!)
  p.set('limit', '10')
  const attempts = useQuery({
    queryKey: ['merchant-report', merchantId, 'attempts', a.toString()],
    queryFn: ({ signal }) =>
      read<ReportPage<AttemptReport>>(`/api/reporting/attempts?${a}`, signal),
  })
  const receipts = useQuery({
    queryKey: ['merchant-report', merchantId, 'receipts', p.toString()],
    queryFn: ({ signal }) =>
      read<ReportPage<ReceiptReport>>(`/api/reporting/receipts?${p}`, signal),
  })
  const error = summary.error ?? attempts.error ?? receipts.error
  useEffect(() => {
    if (error?.message === 'Your session has expired. Sign in again.')
      onUnauthorized()
  }, [error, onUnauthorized])
  function apply(e: FormEvent) {
    e.preventDefault()
    setFilters(draft)
    setAttemptCursor([])
    setReceiptCursor([])
  }
  return (
    <section aria-labelledby="activity-heading" className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 id="activity-heading" className="text-xl font-semibold">
          Payment records and usage
        </h2>
        <Button
          variant="outline"
          onClick={() =>
            void client.invalidateQueries({
              queryKey: ['merchant-report', merchantId],
            })
          }
        >
          Refresh records
        </Button>
      </div>
      <div
        className="rounded-xl border border-primary/30 p-4 text-sm leading-6"
        role="note"
      >
        <strong>Public payments are disabled.</strong> Registry confirmation,
        safe production upstream transport, live facilitator validation and
        dependency review remain blocked. Local simulations are never Mainnet
        revenue. A stored provenance label alone does not prove settlement.
      </div>
      <form
        onSubmit={apply}
        className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2 lg:grid-cols-5"
        aria-label="Reporting filters"
      >
        <label className="text-sm">
          Record source
          <select
            aria-label="Record source"
            className={field}
            value={draft.source}
            onChange={(e) =>
              setDraft({ ...draft, source: e.target.value as ReportSource })
            }
          >
            <option value="all">All owned records</option>
            <option value="local_simulation">Local simulation only</option>
            <option value="unverified">Unverified provenance</option>
            <option value="verified">Verified Mainnet (unavailable)</option>
          </select>
        </label>
        <label className="text-sm">
          Resource filter
          <select
            className={field}
            value={draft.resourceId}
            onChange={(e) => setDraft({ ...draft, resourceId: e.target.value })}
          >
            <option value="">All your resources</option>
            {resources.map((r) => (
              <option key={r.id} value={r.id}>
                {r.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          From date (UTC)
          <input
            type="date"
            className={field}
            value={draft.from}
            onChange={(e) => setDraft({ ...draft, from: e.target.value })}
          />
        </label>
        <label className="text-sm">
          Through date (UTC)
          <input
            type="date"
            className={field}
            value={draft.to}
            onChange={(e) => setDraft({ ...draft, to: e.target.value })}
          />
        </label>
        <Button type="submit" className="self-end">
          Apply filters
        </Button>
        <p className="text-xs text-muted-foreground sm:col-span-2 lg:col-span-5">
          Default: last 30 UTC calendar days. Maximum: 90 days. Counts describe
          persisted attempts and receipts, not measured upstream traffic.
        </p>
      </form>
      {error && (
        <div
          role="alert"
          className="rounded-lg border border-destructive/30 p-4 text-sm"
        >
          <p>{error.message}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button
              variant="outline"
              onClick={() =>
                void client.invalidateQueries({
                  queryKey: ['merchant-report', merchantId],
                })
              }
            >
              Retry reporting
            </Button>
            {error.message.includes('session') && (
              <Button variant="outline" onClick={onUnauthorized}>
                Check sign-in status
              </Button>
            )}
          </div>
        </div>
      )}
      {summary.isPending && <p role="status">Loading activity summary…</p>}
      {summary.data && !summary.error && (
        <>
          <div className="grid gap-4 md:grid-cols-3">
            <Card>
              <CardHeader>
                <CardTitle>Verified Mainnet activity</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="font-semibold">Verification unavailable</p>
                <p className="text-muted-foreground">
                  {summary.data.verified.reason}
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Local simulation receipts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p data-testid="simulation-total" className="font-semibold">
                  {summary.data.receipts.localSimulation} local receipts ·{' '}
                  {atomicToUsdc(
                    summary.data.receipts.localSimulationAmountAtomic,
                  )}{' '}
                  simulated USDC
                </p>
                <p className="text-muted-foreground">
                  Internal records only. Excluded from real settled volume.
                </p>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle>Persisted payment attempts</CardTitle>
              </CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p data-testid="attempt-total" className="font-semibold">
                  {summary.data.attempts.total} attempts
                </p>
                <p>
                  {summary.data.attempts.localSimulation} local simulations ·{' '}
                  {summary.data.attempts.unverified} unverified
                </p>
                <p>
                  {summary.data.receipts.unverified} receipts lack trusted
                  provenance.
                </p>
              </CardContent>
            </Card>
          </div>
          {summary.data.attempts.total > 0 && (
            <dl
              aria-label="Attempt outcomes"
              className="grid gap-3 rounded-xl border p-4 sm:grid-cols-2"
            >
              {Object.entries(summary.data.attempts.byPhase).map(
                ([key, value]) => (
                  <div
                    key={key}
                    className="flex items-start justify-between gap-3 text-sm"
                  >
                    <dt>{phaseLabels[key as keyof typeof phaseLabels]}</dt>
                    <dd className="font-mono">{value}</dd>
                  </div>
                ),
              )}
            </dl>
          )}
          {summary.data.attempts.total === 0 && (
            <p className="text-sm text-muted-foreground">
              No payment activity matches these filters. Saving a resource does
              not enable payments or create payment records.
            </p>
          )}
          <p className="text-xs text-muted-foreground">
            Summary window: {summary.data.window.from} through{' '}
            {summary.data.window.to} UTC. Receipt totals use receipt time;
            attempts use creation time.
          </p>
        </>
      )}
      <div className="grid items-start gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Payment attempts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <label className="block text-sm">
              Attempt phase
              <select
                className={field}
                value={phase}
                onChange={(e) => {
                  setPhase(e.target.value)
                  setAttemptCursor([])
                }}
              >
                <option value="">All phases</option>
                {paymentPhases.map((p) => (
                  <option key={p} value={p}>
                    {phaseLabels[p]}
                  </option>
                ))}
              </select>
            </label>
            {attempts.isPending && (
              <p role="status">Loading payment attempts…</p>
            )}
            {!attempts.error && attempts.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No matching payment attempts.
              </p>
            )}
            {!attempts.error &&
              attempts.data?.items.map((item) => (
                <article
                  key={item.id}
                  className="space-y-2 rounded-lg border p-3 text-sm"
                  data-testid="attempt-record"
                >
                  <h3 className="font-medium break-words">
                    {item.resourceName}
                  </h3>
                  <p>
                    {item.provenance === 'local_simulation'
                      ? 'LOCAL SIMULATION ONLY'
                      : 'UNVERIFIED PROVENANCE'}
                  </p>
                  <p>{phaseLabels[item.phase]}</p>
                  <p>
                    Requested: {atomicToUsdc(item.requestedAmountAtomic)} USDC
                  </p>
                  <p className="text-xs break-all">Attempt {item.id}</p>
                  <p className="text-xs text-muted-foreground">
                    {time(item.createdAt)}
                  </p>
                  {item.phase === 'settlement_unknown' && (
                    <p className="text-xs">
                      Outcome unresolved. Do not request another charge; obtain
                      authoritative reconciliation.
                    </p>
                  )}
                  {item.phase === 'fulfillment_failed' && (
                    <p className="text-xs">
                      Delivery failed after a reported settlement. Preserve
                      evidence; no automatic charge or refund is available.
                    </p>
                  )}
                </article>
              ))}
            <Pagination
              name="attempts"
              previous={attemptCursor.length > 0}
              next={!!attempts.data?.nextCursor}
              busy={attempts.isFetching}
              back={() => setAttemptCursor(attemptCursor.slice(0, -1))}
              forward={() =>
                setAttemptCursor([...attemptCursor, attempts.data!.nextCursor!])
              }
            />
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle>Recorded receipts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {receipts.isPending && <p role="status">Loading receipts…</p>}
            {!receipts.error && receipts.data?.items.length === 0 && (
              <p className="text-sm text-muted-foreground">
                No matching recorded receipts. No verified Mainnet settlement is
                established.
              </p>
            )}
            {!receipts.error &&
              receipts.data?.items.map((item) => (
                <article
                  key={item.id}
                  className="space-y-2 rounded-lg border p-3 text-sm"
                  data-testid="receipt-record"
                >
                  <h3 className="font-medium break-words">
                    {item.resourceName}
                  </h3>
                  <p>
                    {item.provenance === 'local_simulation'
                      ? 'LOCAL SIMULATION ONLY — not a Mainnet transaction'
                      : 'UNVERIFIED — not settlement proof'}
                  </p>
                  <p>
                    {item.amountAtomic !== null
                      ? `${atomicToUsdc(item.amountAtomic)} simulated USDC`
                      : 'Amount and transaction reference withheld pending provenance review.'}
                  </p>
                  <p>{phaseLabels[item.phase]}</p>
                  <p className="text-xs break-all">Receipt {item.id}</p>
                  {item.transactionReference && (
                    <p className="text-xs break-all">
                      Local reference: {item.transactionReference}
                    </p>
                  )}
                  <p className="text-xs text-muted-foreground">
                    {time(item.createdAt)}
                  </p>
                </article>
              ))}
            <Pagination
              name="receipts"
              previous={receiptCursor.length > 0}
              next={!!receipts.data?.nextCursor}
              busy={receipts.isFetching}
              back={() => setReceiptCursor(receiptCursor.slice(0, -1))}
              forward={() =>
                setReceiptCursor([...receiptCursor, receipts.data!.nextCursor!])
              }
            />
          </CardContent>
        </Card>
      </div>
    </section>
  )
}
function Pagination({
  name,
  previous,
  next,
  busy,
  back,
  forward,
}: {
  name: string
  previous: boolean
  next: boolean
  busy: boolean
  back: () => void
  forward: () => void
}) {
  return (
    <nav aria-label={`${name} pagination`} className="flex flex-wrap gap-2">
      <Button
        variant="outline"
        aria-label={`Previous ${name}`}
        disabled={!previous || busy}
        onClick={back}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        aria-label={`Next ${name}`}
        disabled={!next || busy}
        onClick={forward}
      >
        Next
      </Button>
    </nav>
  )
}
