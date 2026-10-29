-- SG-03 schema only. No merchants, resources, payments or analytics are seeded.
CREATE TABLE merchants (
  id TEXT PRIMARY KEY NOT NULL,
  wallet_address TEXT NOT NULL UNIQUE CHECK (length(wallet_address) = 42 AND wallet_address = lower(wallet_address)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE TABLE auth_nonces (
  nonce_hash TEXT PRIMARY KEY NOT NULL CHECK (length(nonce_hash) = 64),
  wallet_address TEXT NOT NULL,
  browser_hash TEXT NOT NULL CHECK (length(browser_hash) = 64),
  requester_hash TEXT NOT NULL,
  origin TEXT NOT NULL,
  message TEXT NOT NULL,
  issued_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > issued_at),
  consumed_at INTEGER,
  claim_session_hash TEXT UNIQUE
);
CREATE INDEX auth_nonces_expiry ON auth_nonces(expires_at);
CREATE INDEX auth_nonces_requester ON auth_nonces(requester_hash, issued_at);
CREATE INDEX auth_nonces_wallet ON auth_nonces(wallet_address, issued_at);
CREATE TABLE sessions (
  token_hash TEXT PRIMARY KEY NOT NULL CHECK (length(token_hash) = 64),
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  origin TEXT NOT NULL,
  chain_id INTEGER NOT NULL CHECK (chain_id = 8453),
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL CHECK (expires_at > created_at),
  revoked_at INTEGER
);
CREATE INDEX sessions_merchant ON sessions(merchant_id);
CREATE INDEX sessions_expiry ON sessions(expires_at);
CREATE TABLE api_resources (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id) ON DELETE CASCADE,
  name TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  upstream_url TEXT NOT NULL CHECK (length(upstream_url) <= 2048),
  response_config TEXT NOT NULL CHECK (json_valid(response_config)),
  price_atomic TEXT NOT NULL CHECK (length(price_atomic) BETWEEN 1 AND 12 AND price_atomic NOT GLOB '*[^0-9]*' AND substr(price_atomic, 1, 1) BETWEEN '1' AND '9'),
  payout_address TEXT NOT NULL CHECK (length(payout_address) = 42),
  network TEXT NOT NULL DEFAULT 'eip155:8453' CHECK (network = 'eip155:8453'),
  enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1)),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  UNIQUE (id, merchant_id)
);
CREATE INDEX api_resources_owner ON api_resources(merchant_id, created_at, id);
CREATE TABLE payment_attempts (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  resource_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  amount_atomic TEXT NOT NULL CHECK (length(amount_atomic) BETWEEN 1 AND 12 AND amount_atomic NOT GLOB '*[^0-9]*' AND substr(amount_atomic, 1, 1) BETWEEN '1' AND '9'),
  status TEXT NOT NULL CHECK (status IN ('created', 'rejected', 'pending', 'settled', 'failed')),
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  FOREIGN KEY (resource_id, merchant_id) REFERENCES api_resources(id, merchant_id),
  UNIQUE (merchant_id, idempotency_key)
);
CREATE INDEX payment_attempts_resource ON payment_attempts(resource_id, created_at);
CREATE TABLE payment_receipts (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL UNIQUE REFERENCES payment_attempts(id),
  transaction_hash TEXT NOT NULL UNIQUE CHECK (length(transaction_hash) = 66),
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  amount_atomic TEXT NOT NULL,
  payer_address TEXT NOT NULL CHECK (length(payer_address) = 42),
  payout_address TEXT NOT NULL CHECK (length(payout_address) = 42),
  block_number TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE TABLE analytics_events (
  id TEXT PRIMARY KEY NOT NULL,
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  resource_id TEXT,
  event_type TEXT NOT NULL CHECK (event_type IN ('resource_created', 'resource_updated', 'resource_disabled', 'payment_attempt', 'payment_settled')),
  occurred_at INTEGER NOT NULL,
  FOREIGN KEY (resource_id, merchant_id) REFERENCES api_resources(id, merchant_id)
);
CREATE INDEX analytics_owner_time ON analytics_events(merchant_id, occurred_at);
