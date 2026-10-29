/** Server-only validation. Import from Functions or isolated runtime fixtures only. */
export interface FoundationConfig {
  db: D1Database
  chainId: 8453
  network: 'eip155:8453'
}

export class ConfigurationError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConfigurationError'
  }
}

export function readFoundationConfig(
  env: Record<string, unknown>,
): FoundationConfig {
  if (env.BASE_CHAIN_ID === undefined || env.BASE_CHAIN_ID === '') {
    throw new ConfigurationError(
      'Missing required configuration: BASE_CHAIN_ID',
    )
  }
  if (env.BASE_CHAIN_ID !== '8453') {
    throw new ConfigurationError('BASE_CHAIN_ID must be 8453 (Base Mainnet)')
  }
  const db = env.SIGNALARC_DB
  if (
    !db ||
    typeof db !== 'object' ||
    !('prepare' in db) ||
    typeof db.prepare !== 'function' ||
    !('batch' in db) ||
    typeof db.batch !== 'function'
  ) {
    throw new ConfigurationError('Missing or invalid D1 binding: SIGNALARC_DB')
  }
  return { db: db as D1Database, chainId: 8453, network: 'eip155:8453' }
}
