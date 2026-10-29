import { ConfigurationError, readFoundationConfig } from '../../server/config'

interface ProbeRecord {
  id: string
  marker: string
  chainId: number
  revision: number
}

async function readProbeState(db: D1Database) {
  const table = await db
    .prepare(
      'SELECT COUNT(*) AS count FROM sqlite_master WHERE type = ? AND name = ?',
    )
    .bind('table', 'sg02_local_d1_write_probe')
    .first<{ count: number }>()
  if (!table) throw new Error('Local D1 table inspection returned no row')
  const tableExists = table.count === 1
  const rows = tableExists
    ? (
        await db
          .prepare(
            'SELECT id, marker, chain_id AS chainId, revision FROM sg02_local_d1_write_probe ORDER BY id',
          )
          .all<ProbeRecord>()
      ).results
    : []
  return { tableExists, rows }
}

/** Fixed SQL and deterministic test data only; no request-supplied SQL or values. */
async function handleWriteProbe(request: Request, db: D1Database) {
  const action = new URL(request.url).pathname.slice('/d1-probe/'.length)
  if (
    !['state', 'create', 'insert', 'update', 'delete', 'cleanup'].includes(
      action,
    )
  ) {
    return new Response('Unknown local D1 probe action', { status: 404 })
  }
  if (request.method !== (action === 'state' ? 'GET' : 'POST')) {
    return new Response('Method not allowed', { status: 405 })
  }
  // Defense in depth: refuse writes unless the emulator identifies itself.
  // The runner independently supplies only --d1 SIGNALARC_DB in a fresh local project.
  const local = await db.prepare('SELECT ? AS chainId').bind(8453).all()
  if (local.meta.served_by !== 'miniflare.db') {
    throw new Error('D1 write probe requires the local Miniflare database')
  }
  let changes: number | undefined
  if (action === 'create') {
    await db
      .prepare(
        'CREATE TABLE sg02_local_d1_write_probe (id TEXT PRIMARY KEY, marker TEXT NOT NULL, chain_id INTEGER NOT NULL, revision INTEGER NOT NULL)',
      )
      .run()
  } else if (action === 'insert') {
    const result = await db
      .prepare(
        'INSERT INTO sg02_local_d1_write_probe (id, marker, chain_id, revision) VALUES (?, ?, ?, ?)',
      )
      .bind('sg02-local-record', 'inserted', 8453, 1)
      .run()
    changes = result.meta.changes
  } else if (action === 'update') {
    const result = await db
      .prepare(
        'UPDATE sg02_local_d1_write_probe SET marker = ?, revision = ? WHERE id = ?',
      )
      .bind('updated', 2, 'sg02-local-record')
      .run()
    changes = result.meta.changes
  } else if (action === 'delete') {
    const result = await db
      .prepare('DELETE FROM sg02_local_d1_write_probe WHERE id = ?')
      .bind('sg02-local-record')
      .run()
    changes = result.meta.changes
  } else if (action === 'cleanup') {
    await db.prepare('DROP TABLE IF EXISTS sg02_local_d1_write_probe').run()
  }
  return Response.json(
    {
      localOnly: true,
      servedBy: local.meta.served_by,
      ...(changes === undefined ? {} : { changes }),
      ...(await readProbeState(db)),
    },
    {
      headers: { 'Cache-Control': 'no-store' },
    },
  )
}

/** Isolated local Pages test handler; never imported by production Functions. */
export async function handleFoundation(
  request: Request,
  env: Record<string, unknown>,
): Promise<Response> {
  if (
    env.SG02_LOCAL_ONLY !== 'yes' ||
    new URL(request.url).hostname !== '127.0.0.1' ||
    env.CF_PAGES_URL !== 'http://127.0.0.1'
  ) {
    return new Response('Local foundation fixture disabled', { status: 404 })
  }
  const isWriteProbe = new URL(request.url).pathname.startsWith('/d1-probe/')
  if (!isWriteProbe && request.method !== 'GET')
    return new Response('Method not allowed', { status: 405 })
  try {
    if (new URL(request.url).pathname === '/configuration') {
      const cases = [
        { ...env, BASE_CHAIN_ID: undefined },
        { ...env, BASE_CHAIN_ID: 'invalid-configuration-value' },
        { ...env, SIGNALARC_DB: undefined },
        { ...env, SIGNALARC_DB: {} },
      ]
      const errors = cases.map((candidate) => {
        try {
          readFoundationConfig(candidate)
          return 'unexpected success'
        } catch (error) {
          if (error instanceof ConfigurationError) return error.message
          throw error
        }
      })
      return Response.json(
        { localOnly: true, errors },
        { headers: { 'Cache-Control': 'no-store' } },
      )
    }
    const { db, chainId, network } = readFoundationConfig(env)
    if (isWriteProbe) return await handleWriteProbe(request, db)
    const row = await db
      .prepare('SELECT ? AS chainId, ? + ? AS calculation')
      .bind(chainId, 19, 23)
      .first<{ chainId: number; calculation: number }>()
    if (!row) throw new Error('Local D1 query returned no row')
    return Response.json(
      { localOnly: true, network, ...row },
      { headers: { 'Cache-Control': 'no-store' } },
    )
  } catch (error) {
    return Response.json(
      {
        error:
          error instanceof ConfigurationError
            ? error.message
            : 'Local D1 smoke test failed',
      },
      { status: 503 },
    )
  }
}
