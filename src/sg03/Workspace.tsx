import { useState, useEffect, useCallback, type FormEvent } from 'react'
import { getConnection } from 'wagmi/actions'
import {
  WagmiProvider,
  useConnection,
  useConnect,
  useConnectors,
  useDisconnect,
  useSignMessage,
  useSwitchChain,
} from 'wagmi'
import {
  QueryClient,
  QueryClientProvider,
  useQuery,
  useQueryClient,
  useMutation,
} from '@tanstack/react-query'
import { walletConfig } from './wallet'
import Activity from '../sg06/Activity'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  atomicToUsdc,
  usdcToAtomic,
  type Resource,
  type ResourceInput,
} from '../../shared/resources'

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: false, staleTime: 0 },
    mutations: { retry: false },
  },
})
type Session =
  | { authenticated: false }
  | {
      authenticated: true
      merchant: { id: string; walletAddress: string }
      expiresAt: number
    }
async function api<T>(
  path: string,
  method = 'GET',
  data?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(path, {
    method,
    credentials: 'same-origin',
    cache: 'no-store',
    signal: signal
      ? AbortSignal.any([signal, AbortSignal.timeout(10000)])
      : AbortSignal.timeout(10000),
    headers:
      method === 'GET'
        ? {}
        : { 'Content-Type': 'application/json', 'X-SignalArc-Request': '1' },
    ...(method === 'GET' ? {} : { body: JSON.stringify(data ?? {}) }),
  })
  const body = await response.json()
  if (!response.ok)
    throw Object.assign(
      new Error(
        typeof body.error === 'string'
          ? body.error
          : `Request failed (HTTP ${response.status})`,
      ),
      { status: response.status },
    )
  return body as T
}
function errorMessage(error: unknown) {
  return error instanceof Error
    ? error.message
    : 'The operation failed. Please try again.'
}
const inputClass =
  'mt-2 w-full rounded-md border bg-background px-3 py-2 text-sm focus:outline-2 focus:outline-primary'

function Manager() {
  const client = useQueryClient()
  const connection = useConnection()
  const connectors = useConnectors()
  const connect = useConnect()
  const disconnect = useDisconnect()
  const signer = useSignMessage()
  const switcher = useSwitchChain()
  const [identityBlocked, setIdentityBlocked] = useState(false)
  const [message, setMessage] = useState('')
  const [editing, setEditing] = useState<Resource | null | undefined>(undefined)
  const session = useQuery({
    queryKey: ['session'],
    queryFn: ({ signal }) =>
      api<Session>('/api/auth/session', 'GET', undefined, signal),
  })
  const merchant =
    !identityBlocked && session.data?.authenticated
      ? session.data.merchant
      : undefined
  const list = useQuery({
    queryKey: ['resources', merchant?.id],
    queryFn: ({ signal }) =>
      api<{ resources: Resource[] }>(
        '/api/resources',
        'GET',
        undefined,
        signal,
      ),
    enabled: !!merchant,
  })
  const clearMerchantData = useCallback(async () => {
    await Promise.all([
      client.cancelQueries({ queryKey: ['resources'] }),
      client.cancelQueries({ queryKey: ['merchant-report'] }),
    ])
    client.removeQueries({ queryKey: ['resources'] })
    client.removeQueries({ queryKey: ['merchant-report'] })
  }, [client])
  const sessionEnded = useCallback(() => {
    void client.cancelQueries({ queryKey: ['session'] })
    client.setQueryData(['session'], { authenticated: false })
    void clearMerchantData()
  }, [client, clearMerchantData])
  useEffect(() => {
    if (list.error && 'status' in list.error && list.error.status === 401)
      sessionEnded()
  }, [list.error, sessionEnded])
  useEffect(() => {
    if (!session.data?.authenticated) return
    const timer = setTimeout(
      sessionEnded,
      Math.max(0, session.data.expiresAt - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [session.data, sessionEnded])
  const wrongNetwork = connection.isConnected && connection.chainId !== 8453
  const sessionMismatch =
    merchant &&
    connection.address &&
    merchant.walletAddress.toLowerCase() !== connection.address.toLowerCase()
  const signIn = useMutation({
    mutationFn: async () => {
      if (!connection.address || connection.chainId !== 8453)
        throw new Error('Connect an EOA wallet on Base Mainnet first')
      const address = connection.address
      function ensureWalletUnchanged() {
        const current = getConnection(walletConfig)
        if (
          current.chainId !== 8453 ||
          current.address?.toLowerCase() !== address.toLowerCase()
        ) {
          throw new Error(
            'Wallet or network changed during sign-in. Please try again on Base Mainnet.',
          )
        }
      }
      const challenge = await api<{ message: string }>(
        '/api/auth/nonce',
        'POST',
        { address: connection.address, chainId: 8453 },
      )
      ensureWalletUnchanged()
      const signature = await signer.signMessageAsync({
        account: address,
        message: challenge.message,
      })
      ensureWalletUnchanged()
      await api('/api/auth/verify', 'POST', {
        message: challenge.message,
        signature,
      })
    },
    onSuccess: async () => {
      setMessage('')
      await client.cancelQueries({ queryKey: ['session'] })
      await clearMerchantData()
      setEditing(undefined)
      setIdentityBlocked(false)
      await client.invalidateQueries({ queryKey: ['session'] })
    },
  })
  const logout = useMutation({
    onMutate: async () => {
      setEditing(undefined)
      setIdentityBlocked(true)
      await client.cancelQueries({ queryKey: ['session'] })
      await clearMerchantData()
    },
    mutationFn: () => api('/api/auth/logout', 'POST'),
    onSuccess: () => {
      client.setQueryData(['session'], { authenticated: false })
    },
    onSettled: async () => {
      setIdentityBlocked(false)
      await client.invalidateQueries({ queryKey: ['session'] })
    },
  })
  const disable = useMutation({
    mutationFn: (id: string) => api(`/api/resources/${id}`, 'DELETE'),
    onSuccess: () => client.invalidateQueries({ queryKey: ['resources'] }),
  })
  const edit = useMutation({
    mutationFn: (id: string) =>
      api<{ resource: Resource }>(`/api/resources/${id}`),
    onSuccess: (result) => setEditing(result.resource),
  })
  const save = useMutation({
    mutationFn: ({ input, id }: { input: ResourceInput; id?: string }) =>
      api(
        id ? `/api/resources/${id}` : '/api/resources',
        id ? 'PATCH' : 'POST',
        input,
      ),
    onSuccess: async () => {
      setEditing(undefined)
      await client.invalidateQueries({ queryKey: ['resources'] })
    },
  })
  async function disconnectWallet() {
    try {
      await logout.mutateAsync()
      await disconnect.disconnectAsync()
      setMessage('')
    } catch (error) {
      setMessage(errorMessage(error))
    }
  }
  const errors = [
    message,
    connect.error?.message,
    switcher.error?.message,
    signIn.error?.message,
    logout.error?.message,
    edit.error?.message,
    disable.error?.message,
    save.error?.message,
  ].filter(Boolean)
  return (
    <div className="app-shell mx-auto max-w-6xl px-6 py-8 sm:px-10">
      <header className="mb-10 flex flex-wrap items-center justify-between gap-4">
        <a href="/" className="font-semibold text-primary">
          ← SignalArc Gate
        </a>
        <span className="rounded-full border px-3 py-1 text-xs">
          Base Mainnet · 8453
        </span>
      </header>
      <main className="space-y-8">
        <section>
          <p className="mb-3 text-xs font-semibold tracking-widest text-primary uppercase">
            Developer workspace
          </p>
          <h1 className="text-3xl font-semibold tracking-tight">
            Manage API resources
          </h1>
          <p className="mt-3 text-sm leading-6 text-muted-foreground">
            Connect your wallet and sign in to manage your own endpoint
            configurations. Upstream fetching and payments are not enabled.
          </p>
        </section>
        <Card>
          <CardHeader>
            <CardTitle>Wallet and authentication</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <p className="text-sm break-all">
              {connection.isConnected
                ? `Connected wallet: ${connection.address}`
                : 'No wallet connected.'}
            </p>
            {!connection.isConnected && (
              <div className="flex flex-wrap gap-3">
                {connectors.map((connector) => (
                  <Button
                    key={connector.uid}
                    disabled={connect.isPending}
                    onClick={() => {
                      connect.reset()
                      connect.connect({ connector })
                    }}
                  >
                    {connect.isPending
                      ? 'Connecting…'
                      : `Connect ${connector.name}`}
                  </Button>
                ))}
                <p className="text-xs text-muted-foreground">
                  Use a compatible injected EVM wallet. No private key or seed
                  phrase is requested.
                </p>
              </div>
            )}
            {wrongNetwork && (
              <div
                role="alert"
                className="rounded-lg border border-destructive/30 p-4 text-sm"
              >
                <p>Wrong network. Switch to Base Mainnet to sign in.</p>
                <Button
                  className="mt-3"
                  disabled={switcher.isPending}
                  onClick={() => switcher.switchChain({ chainId: 8453 })}
                >
                  Switch to Base Mainnet
                </Button>
              </div>
            )}
            {session.isPending && <p role="status">Checking authentication…</p>}
            {session.error && (
              <div role="alert">
                <p>{session.error.message}</p>
                <Button
                  variant="outline"
                  onClick={() => void session.refetch()}
                >
                  Retry authentication status
                </Button>
              </div>
            )}
            {merchant ? (
              <p
                className="text-sm break-all"
                data-testid="authenticated-wallet"
              >
                Signed in as {merchant.walletAddress}
              </p>
            ) : (
              session.data && (
                <p className="text-sm text-muted-foreground">Not signed in.</p>
              )
            )}
            {sessionMismatch && (
              <p role="alert" className="text-sm">
                The connected wallet differs from the signed-in identity. Log
                out before signing in with another wallet.
              </p>
            )}
            <div className="flex flex-wrap gap-3">
              {connection.isConnected && !merchant && (
                <Button
                  disabled={
                    wrongNetwork || signIn.isPending || session.isPending
                  }
                  onClick={() => {
                    signIn.reset()
                    signIn.mutate()
                  }}
                >
                  {signIn.isPending
                    ? 'Awaiting signature…'
                    : 'Sign in with Ethereum'}
                </Button>
              )}
              {merchant && (
                <Button
                  variant="outline"
                  disabled={logout.isPending}
                  onClick={() => logout.mutate()}
                >
                  Log out
                </Button>
              )}
              {connection.isConnected && (
                <Button
                  variant="outline"
                  disabled={logout.isPending || signIn.isPending}
                  onClick={() => void disconnectWallet()}
                >
                  Disconnect wallet
                </Button>
              )}
            </div>
            <p className="text-xs leading-5 text-muted-foreground">
              Only EOA personal-sign authentication is supported.
              Contract-wallet signatures are rejected. Signing in authorizes no
              transaction or payment.
            </p>
          </CardContent>
        </Card>
        {errors.length > 0 && (
          <div
            role="alert"
            className="rounded-lg border border-destructive/30 p-4 text-sm text-destructive"
          >
            {errors.map((error, i) => (
              <p className="break-words" key={i}>
                {String(error).slice(0, 256)}
              </p>
            ))}
          </div>
        )}
        {merchant && (
          <section aria-labelledby="resources-heading" className="space-y-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 id="resources-heading" className="text-xl font-semibold">
                Your API resources
              </h2>
              <Button
                onClick={() => {
                  save.reset()
                  setEditing(null)
                }}
              >
                Create resource
              </Button>
            </div>
            {editing !== undefined && (
              <ResourceForm
                key={editing?.id ?? 'new'}
                resource={editing}
                wallet={merchant.walletAddress}
                busy={save.isPending}
                onCancel={() => setEditing(undefined)}
                onSave={(input) => save.mutate({ input, id: editing?.id })}
              />
            )}
            {list.isPending && <p role="status">Loading resources…</p>}
            {list.error && (
              <div role="alert">
                <p>{list.error.message}</p>
                <Button variant="outline" onClick={() => void list.refetch()}>
                  Retry resources
                </Button>
              </div>
            )}
            {list.data?.resources.length === 0 && (
              <div className="rounded-xl border border-dashed p-7 text-sm text-muted-foreground">
                No API resources yet. Create a resource to save its URL, USDC
                price and payout settings.
              </div>
            )}
            <div className="grid gap-4 md:grid-cols-2">
              {!list.error &&
                list.data?.resources.map((resource) => (
                  <Card key={resource.id}>
                    <CardHeader>
                      <CardTitle className="break-words">
                        {resource.name}
                      </CardTitle>
                    </CardHeader>
                    <CardContent className="space-y-3 text-sm">
                      <p className="break-all">{resource.upstreamUrl}</p>
                      <dl className="space-y-2">
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Resource ID
                          </dt>
                          <dd className="break-all font-mono text-xs">
                            {resource.id}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Price
                          </dt>
                          <dd>{atomicToUsdc(resource.priceAtomic)} USDC</dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Payout address
                          </dt>
                          <dd className="break-all font-mono text-xs">
                            {resource.payoutAddress}
                          </dd>
                        </div>
                        <div>
                          <dt className="text-xs text-muted-foreground">
                            Status
                          </dt>
                          <dd>{resource.enabled ? 'Enabled' : 'Disabled'}</dd>
                        </div>
                      </dl>
                      <div className="flex flex-wrap gap-2">
                        <Button
                          aria-label={`Edit ${resource.name}`}
                          variant="outline"
                          disabled={edit.isPending}
                          onClick={() => edit.mutate(resource.id)}
                        >
                          Edit
                        </Button>
                        <Button
                          aria-label={`Disable ${resource.name}`}
                          variant="outline"
                          disabled={!resource.enabled || disable.isPending}
                          onClick={() => disable.mutate(resource.id)}
                        >
                          Disable
                        </Button>
                      </div>
                    </CardContent>
                  </Card>
                ))}
            </div>
          </section>
        )}
        {merchant && (
          <Activity
            key={merchant.id}
            merchantId={merchant.id}
            resources={list.data?.resources ?? []}
            onUnauthorized={sessionEnded}
          />
        )}
      </main>
    </div>
  )
}
function ResourceForm({
  resource,
  wallet,
  busy,
  onSave,
  onCancel,
}: {
  resource: Resource | null
  wallet: string
  busy: boolean
  onSave: (input: ResourceInput) => void
  onCancel: () => void
}) {
  const [name, setName] = useState(resource?.name ?? '')
  const [url, setUrl] = useState(resource?.upstreamUrl ?? '')
  const [price, setPrice] = useState(
    resource ? atomicToUsdc(resource.priceAtomic) : '',
  )
  const [payout, setPayout] = useState(resource?.payoutAddress ?? wallet)
  const [maxBytes, setMaxBytes] = useState(
    String(resource?.responseConfig.maxBytes ?? 65536),
  )
  const [enabled, setEnabled] = useState(resource?.enabled ?? true)
  const [error, setError] = useState('')
  function submit(event: FormEvent) {
    event.preventDefault()
    try {
      const priceAtomic = usdcToAtomic(price)
      onSave({
        name,
        upstreamUrl: url,
        priceAtomic,
        payoutAddress: payout,
        network: 'eip155:8453',
        enabled,
        responseConfig: {
          type: 'json',
          redirects: 'error',
          maxBytes: Number(maxBytes),
        },
      })
      setError('')
    } catch (error) {
      setError(errorMessage(error))
    }
  }
  return (
    <Card>
      <CardHeader>
        <CardTitle>{resource ? 'Edit resource' : 'Create resource'}</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-5 sm:grid-cols-2" onSubmit={submit}>
          <label className="text-sm">
            Resource name
            <input
              className={inputClass}
              required
              maxLength={80}
              value={name}
              onChange={(event) => setName(event.target.value)}
            />
          </label>
          <label className="text-sm">
            USDC price
            <input
              className={inputClass}
              required
              inputMode="decimal"
              value={price}
              onChange={(event) => setPrice(event.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            HTTPS upstream URL
            <input
              className={inputClass}
              required
              type="url"
              maxLength={2048}
              value={url}
              onChange={(event) => setUrl(event.target.value)}
            />
          </label>
          <label className="text-sm sm:col-span-2">
            Payout wallet address
            <input
              className={inputClass}
              required
              value={payout}
              onChange={(event) => setPayout(event.target.value)}
            />
          </label>
          <label className="text-sm">
            JSON response byte limit
            <input
              className={inputClass}
              required
              type="number"
              min={1024}
              max={1048576}
              step={1}
              value={maxBytes}
              onChange={(event) => setMaxBytes(event.target.value)}
            />
          </label>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={enabled}
              onChange={(event) => setEnabled(event.target.checked)}
            />
            Enabled configuration
          </label>
          <p className="text-xs leading-6 text-muted-foreground sm:col-span-2">
            JSON responses only. Redirects are forbidden. Saving validates and
            stores configuration without contacting the upstream.
          </p>
          {error && (
            <p role="alert" className="text-sm text-destructive sm:col-span-2">
              {error}
            </p>
          )}
          <div className="flex flex-wrap gap-3 sm:col-span-2">
            <Button type="submit" disabled={busy}>
              {busy ? 'Saving…' : 'Save resource'}
            </Button>
            <Button
              type="button"
              variant="outline"
              disabled={busy}
              onClick={onCancel}
            >
              Cancel
            </Button>
          </div>
        </form>
      </CardContent>
    </Card>
  )
}
export default function Workspace() {
  return (
    <WagmiProvider config={walletConfig}>
      <QueryClientProvider client={queryClient}>
        <Manager />
      </QueryClientProvider>
    </WagmiProvider>
  )
}
