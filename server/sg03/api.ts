import { currentSession, logout, nonce, verify } from './auth'
import { apiConfig, apiError, HttpError, requireCsrf } from './http'
import { resources } from './resources'

export async function handleApi(
  request: Request,
  env: Record<string, unknown>,
) {
  try {
    if (request.url.length > 2048)
      throw new HttpError(414, 'Request URL exceeds limit')
    if (Number(request.headers.get('Content-Length') ?? '0') > 16384)
      throw new HttpError(413, 'Request body exceeds 16 KiB')
    const path = new URL(request.url).pathname
    const known =
      [
        '/api/auth/nonce',
        '/api/auth/verify',
        '/api/auth/session',
        '/api/auth/logout',
        '/api/resources',
      ].includes(path) || /^\/api\/resources\/[^/]+$/.test(path)
    if (!known) throw new HttpError(404, 'API route not found')
    const config = apiConfig(request, env)
    if (!['GET', 'POST', 'PATCH', 'DELETE'].includes(request.method))
      throw new HttpError(405, 'Method not allowed')
    if (request.method !== 'GET') requireCsrf(request, config)
    if (path === '/api/auth/nonce' && request.method === 'POST')
      return await nonce(request, config)
    if (path === '/api/auth/verify' && request.method === 'POST')
      return await verify(request, config)
    if (path === '/api/auth/session' && request.method === 'GET')
      return await currentSession(request, config)
    if (path === '/api/auth/logout' && request.method === 'POST')
      return await logout(request, config)
    if (path === '/api/resources' || path.startsWith('/api/resources/'))
      return await resources(request, config, path.split('/')[3])
    throw new HttpError(405, 'Method not allowed')
  } catch (error) {
    return apiError(error)
  }
}
