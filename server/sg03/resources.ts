import {
  keys,
  object,
  resourceFields,
  resourceInput,
  type Resource,
} from '../../shared/resources'
import { requireSession } from './auth'
import { HttpError, json, readJson, type ApiConfig } from './http'

interface ResourceRow {
  id: string
  name: string
  upstream_url: string
  response_config: string
  price_atomic: string
  payout_address: string
  enabled: number
  network: 'eip155:8453'
  created_at: number
  updated_at: number
}
function present(row: ResourceRow): Resource {
  return {
    id: row.id,
    name: row.name,
    upstreamUrl: row.upstream_url,
    responseConfig: JSON.parse(row.response_config),
    priceAtomic: row.price_atomic,
    payoutAddress: row.payout_address,
    network: row.network,
    enabled: row.enabled === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }
}
export async function resources(
  request: Request,
  config: ApiConfig,
  id?: string,
) {
  const active = await requireSession(request, config)
  const db = config.db
  if (!id && request.method === 'GET') {
    const rows = await db
      .prepare(
        'SELECT * FROM api_resources WHERE merchant_id = ? ORDER BY created_at DESC, id LIMIT 100',
      )
      .bind(active.merchant_id)
      .all<ResourceRow>()
    return json({ resources: rows.results.map(present) })
  }
  if (!id && request.method === 'POST') {
    const input = resourceInput(await readJson(request))
    if (new URL(input.upstreamUrl).hostname === new URL(config.origin).hostname)
      throw new HttpError(422, 'Gateway cannot be its own upstream')
    const resourceId = crypto.randomUUID(),
      now = Date.now()
    const inserted = await db
      .prepare(
        `INSERT INTO api_resources
      (id, merchant_id, name, upstream_url, response_config, price_atomic, payout_address, network, enabled, created_at, updated_at)
      SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?
      WHERE (SELECT COUNT(*) FROM api_resources WHERE merchant_id = ?) < 100`,
      )
      .bind(
        resourceId,
        active.merchant_id,
        input.name,
        input.upstreamUrl,
        JSON.stringify(input.responseConfig),
        input.priceAtomic,
        input.payoutAddress,
        input.network,
        Number(input.enabled),
        now,
        now,
        active.merchant_id,
      )
      .run()
    if (inserted.meta.changes !== 1)
      throw new HttpError(409, 'Merchant resource limit reached (100)')
    const row = await db
      .prepare('SELECT * FROM api_resources WHERE id = ? AND merchant_id = ?')
      .bind(resourceId, active.merchant_id)
      .first<ResourceRow>()
    return json({ resource: present(row!) }, 201)
  }
  if (!id || !/^[a-f0-9-]{36}$/.test(id))
    throw new HttpError(404, 'Resource not found')
  const existing = await db
    .prepare('SELECT * FROM api_resources WHERE id = ? AND merchant_id = ?')
    .bind(id, active.merchant_id)
    .first<ResourceRow>()
  if (!existing) throw new HttpError(404, 'Resource not found')
  if (request.method === 'GET') return json({ resource: present(existing) })
  const now = Date.now()
  if (request.method === 'DELETE') {
    keys(object(await readJson(request)), [])
    await db
      .prepare(
        'UPDATE api_resources SET enabled = ?, updated_at = ? WHERE id = ? AND merchant_id = ?',
      )
      .bind(0, now, id, active.merchant_id)
      .run()
  } else if (request.method === 'PATCH') {
    const patch = object(await readJson(request))
    keys(patch, resourceFields)
    if (Object.keys(patch).length === 0)
      throw new HttpError(422, 'At least one setting is required')
    const current = present(existing)
    const { id: omittedId, createdAt, updatedAt, ...settings } = current
    void omittedId
    void createdAt
    void updatedAt
    const input = resourceInput({ ...settings, ...patch })
    if (new URL(input.upstreamUrl).hostname === new URL(config.origin).hostname)
      throw new HttpError(422, 'Gateway cannot be its own upstream')
    await db
      .prepare(
        `UPDATE api_resources SET name = ?, upstream_url = ?, response_config = ?, price_atomic = ?, payout_address = ?, enabled = ?, updated_at = ? WHERE id = ? AND merchant_id = ?`,
      )
      .bind(
        input.name,
        input.upstreamUrl,
        JSON.stringify(input.responseConfig),
        input.priceAtomic,
        input.payoutAddress,
        Number(input.enabled),
        now,
        id,
        active.merchant_id,
      )
      .run()
  } else throw new HttpError(405, 'Method not allowed')
  const updated = await db
    .prepare('SELECT * FROM api_resources WHERE id = ? AND merchant_id = ?')
    .bind(id, active.merchant_id)
    .first<ResourceRow>()
  return json({ resource: present(updated!) })
}
