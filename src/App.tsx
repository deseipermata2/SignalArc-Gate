import { lazy, Suspense, useEffect, useState } from 'react'
import { Button } from '@/components/ui/button'
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from '@/components/ui/card'
import './App.css'

interface HealthResponse {
  status: 'ok'
  service: 'SignalArc Gate'
  network: 'base-mainnet'
  chainId: 8453
}

type HealthState =
  | { state: 'loading' }
  | { state: 'success'; response: HealthResponse }
  | { state: 'error'; message: string }

const Workspace = lazy(() => import('./sg03/Workspace'))

function FoundationApp() {
  const [attempt, setAttempt] = useState(0)
  const [health, setHealth] = useState<HealthState>({ state: 'loading' })

  useEffect(() => {
    const controller = new AbortController()
    const timeout = AbortSignal.timeout(8000)
    async function loadHealth() {
      try {
        const response = await fetch('/api/health', {
          cache: 'no-store',
          signal: AbortSignal.any([controller.signal, timeout]),
        })
        if (!response.ok)
          throw new Error(`Health endpoint returned HTTP ${response.status}.`)
        const data: unknown = await response.json()
        if (
          !data ||
          typeof data !== 'object' ||
          !('status' in data) ||
          data.status !== 'ok' ||
          !('service' in data) ||
          data.service !== 'SignalArc Gate' ||
          !('network' in data) ||
          data.network !== 'base-mainnet' ||
          !('chainId' in data) ||
          data.chainId !== 8453
        ) {
          throw new Error(
            'The health response does not match the SignalArc Gate Base Mainnet service.',
          )
        }
        // Only the health contract is rendered; unexpected response fields are not exposed.
        setHealth({
          state: 'success',
          response: {
            status: data.status,
            service: data.service,
            network: data.network,
            chainId: data.chainId,
          },
        })
      } catch (error) {
        if (controller.signal.aborted) return
        setHealth({
          state: 'error',
          message: timeout.aborted
            ? 'The health request timed out. Try again.'
            : error instanceof Error
              ? error.message
              : 'Unable to reach the health endpoint.',
        })
      }
    }
    void loadHealth()
    return () => controller.abort()
  }, [attempt])

  function refresh() {
    setHealth({ state: 'loading' })
    setAttempt((value) => value + 1)
  }

  return (
    <div className="app-shell">
      <header className="mx-auto flex flex-wrap max-w-6xl items-center justify-between gap-4 px-6 py-7 sm:px-10">
        <a
          href="/"
          className="flex items-center gap-3 font-semibold tracking-tight"
          aria-label="SignalArc Gate home"
        >
          <span
            aria-hidden="true"
            className="flex size-9 items-center justify-center rounded-lg bg-primary text-sm font-bold text-primary-foreground"
          >
            SG
          </span>
          SignalArc Gate
        </a>
        <a href="/manage" className="text-sm font-medium text-primary">
          Manage APIs
        </a>
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs font-medium">
          Base Mainnet
        </span>
      </header>
      <main className="mx-auto grid max-w-6xl items-start gap-12 px-6 pb-16 pt-12 sm:px-10 lg:grid-cols-[1fr_1fr] lg:gap-16 lg:pt-24">
        <section aria-labelledby="product-title">
          <p className="mb-5 text-xs font-semibold tracking-[0.18em] text-primary uppercase">
            API access, powered by x402
          </p>
          <h1
            id="product-title"
            className="text-4xl leading-[1.1] font-semibold tracking-tight sm:text-5xl"
          >
            SignalArc Gate
          </h1>
          <p className="mt-5 max-w-md text-xl leading-relaxed text-muted-foreground">
            A Base-native x402 API monetization gateway.
          </p>
          <p className="mt-5 max-w-md text-sm leading-7 text-muted-foreground">
            Built for developers who want to price API access in USDC and
            receive payments directly to their own wallets.
          </p>
          <dl className="mt-9 grid grid-cols-2 gap-5 border-y border-border py-6 text-sm">
            <div>
              <dt className="text-muted-foreground">Target network</dt>
              <dd className="mt-2 font-medium">Base Mainnet · 8453</dd>
            </div>
            <div>
              <dt className="text-muted-foreground">Payment protocol</dt>
              <dd className="mt-2 font-medium">x402 · USDC</dd>
            </div>
          </dl>
          <p className="mt-6 text-xs leading-6 text-muted-foreground">
            The service check confirms API availability. Payment execution is
            not enabled on this screen.
          </p>
        </section>
        <Card
          className="min-w-0 border-border/80 shadow-sm"
          aria-labelledby="service-title"
        >
          <CardHeader>
            <div className="mb-2 flex items-center justify-between text-xs text-muted-foreground">
              <span>Service status</span>
              <code>GET /api/health</code>
            </div>
            <CardTitle id="service-title" className="text-xl">
              Gateway health
            </CardTitle>
            <CardDescription>
              Live response from this application’s health endpoint.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-5">
            <div
              aria-live="polite"
              aria-atomic="true"
              aria-busy={health.state === 'loading'}
            >
              {health.state === 'loading' && (
                <p
                  role="status"
                  className="rounded-lg bg-muted px-4 py-5 text-sm text-muted-foreground"
                >
                  Checking service…
                </p>
              )}
              {health.state === 'error' && (
                <div
                  role="alert"
                  className="rounded-lg border border-destructive/30 bg-destructive/5 p-4"
                >
                  <p className="text-sm font-medium text-destructive">
                    Service check failed
                  </p>
                  <p className="mt-2 text-sm leading-6">{health.message}</p>
                </div>
              )}
              {health.state === 'success' && (
                <div>
                  <p className="mb-4 flex items-center gap-2 text-sm font-medium">
                    <span
                      aria-hidden="true"
                      className="size-2 rounded-full bg-emerald-600"
                    />
                    Gateway reachable{' '}
                    <span className="ml-auto font-mono text-xs text-muted-foreground">
                      HTTP 200
                    </span>
                  </p>
                  <pre
                    aria-label="Actual health response"
                    className="health-response rounded-lg border border-border bg-muted/60 p-4 text-xs leading-7"
                  >
                    {JSON.stringify(health.response, null, 2)}
                  </pre>
                </div>
              )}
            </div>
            <Button
              type="button"
              onClick={refresh}
              disabled={health.state === 'loading'}
              className="w-full"
            >
              {health.state === 'loading' ? 'Checking…' : 'Check again'}
            </Button>
          </CardContent>
        </Card>
      </main>
      <footer className="mx-auto flex max-w-6xl flex-wrap justify-between gap-3 border-t border-border px-6 py-6 text-xs text-muted-foreground sm:px-10">
        <span>SignalArc Gate</span>
        <span>Base-native API monetization</span>
      </footer>
    </div>
  )
}

export default function App() {
  return window.location.pathname === '/manage' ? (
    <Suspense
      fallback={
        <p role="status" className="p-8">
          Loading workspace…
        </p>
      }
    >
      <Workspace />
    </Suspense>
  ) : (
    <FoundationApp />
  )
}
