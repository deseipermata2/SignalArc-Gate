-- signalarc:statement
-- Forward-only SG-05 additions. Existing SG-03 rows and constraints are preserved.
ALTER TABLE api_resources ADD COLUMN payment_revision INTEGER NOT NULL DEFAULT 1 CHECK (typeof(payment_revision) = 'integer' AND payment_revision BETWEEN 1 AND 9007199254740991);
-- signalarc:statement
CREATE TRIGGER api_resources_payment_revision AFTER UPDATE OF merchant_id, name, upstream_url, response_config, price_atomic, payout_address, network, enabled, updated_at ON api_resources
BEGIN
  UPDATE api_resources SET payment_revision = OLD.payment_revision + 1 WHERE id = NEW.id;
END;
-- signalarc:statement
CREATE TABLE resource_registry_bindings (
  resource_id TEXT PRIMARY KEY NOT NULL REFERENCES api_resources(id),
  original_owner TEXT NOT NULL,
  onchain_resource_id TEXT NOT NULL UNIQUE CHECK (length(onchain_resource_id) = 66),
  registry_address TEXT,
  config_salt TEXT NOT NULL CHECK (length(config_salt) = 66),
  config_hash TEXT NOT NULL CHECK (length(config_hash) = 66),
  registry_version TEXT NOT NULL,
  source TEXT NOT NULL CHECK (source IN ('unconfirmed', 'local_simulation', 'onchain_confirmed')),
  block_hash TEXT,
  block_number TEXT,
  checked_at INTEGER NOT NULL,
  generation INTEGER NOT NULL DEFAULT 1 CHECK (typeof(generation) = 'integer' AND generation BETWEEN 1 AND 9007199254740991),
  CHECK (source != 'local_simulation' OR (registry_address IS NULL AND block_hash IS NULL AND block_number IS NULL)),
  CHECK (source != 'onchain_confirmed' OR (registry_address IS NOT NULL AND block_hash IS NOT NULL AND block_number IS NOT NULL))
);
-- signalarc:statement
CREATE TRIGGER registry_binding_generation AFTER UPDATE OF original_owner, onchain_resource_id, registry_address, config_salt, config_hash, registry_version, source, block_hash, block_number, checked_at ON resource_registry_bindings
BEGIN
  UPDATE resource_registry_bindings SET generation = OLD.generation + 1 WHERE resource_id = NEW.resource_id;
END;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN phase TEXT NOT NULL DEFAULT 'legacy_unreconciled' CHECK (phase IN ('legacy_unreconciled', 'created', 'rejected', 'verifying', 'verified', 'settlement_pending', 'settlement_unknown', 'settled', 'failed', 'fulfilling', 'fulfilled', 'fulfillment_failed'));
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN authorization_key TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN authorization_fingerprint TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN buyer_address TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN asset TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN recipient TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN request_hash TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN url_hash TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN requirements_json TEXT CHECK (requirements_json IS NULL OR json_valid(requirements_json));
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN snapshot_hash TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN config_revision INTEGER;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN binding_generation INTEGER;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN config_version TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN config_hash TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN expires_at INTEGER;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN operation_deadline INTEGER;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN failure_code TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'legacy_unconfirmed' CHECK (evidence_kind IN ('legacy_unconfirmed', 'local_simulation', 'confirmed_onchain'));
-- signalarc:statement
CREATE UNIQUE INDEX payment_authorization_identity ON payment_attempts(authorization_key) WHERE authorization_key IS NOT NULL;
-- signalarc:statement
CREATE UNIQUE INDEX payment_authorization_fingerprint ON payment_attempts(authorization_fingerprint) WHERE authorization_fingerprint IS NOT NULL;
-- signalarc:statement
CREATE INDEX payment_recovery ON payment_attempts(phase, operation_deadline);
-- signalarc:statement
CREATE TRIGGER payment_phase_transitions BEFORE UPDATE OF phase ON payment_attempts
WHEN OLD.phase != NEW.phase AND NOT (
  (OLD.phase = 'created' AND NEW.phase IN ('verifying', 'rejected', 'failed')) OR
  (OLD.phase = 'verifying' AND NEW.phase IN ('verified', 'rejected', 'failed')) OR
  (OLD.phase = 'verified' AND NEW.phase IN ('settlement_pending', 'failed')) OR
  (OLD.phase = 'settlement_pending' AND NEW.phase IN ('settled', 'failed', 'settlement_unknown')) OR
  (OLD.phase = 'settlement_unknown' AND NEW.phase IN ('settled', 'failed')) OR
  (OLD.phase = 'settled' AND NEW.phase IN ('fulfilling', 'fulfillment_failed')) OR
  (OLD.phase = 'fulfilling' AND NEW.phase IN ('fulfilled', 'fulfillment_failed'))
)
BEGIN
  SELECT RAISE(ABORT, 'invalid_payment_phase_transition');
END;
-- signalarc:statement
ALTER TABLE payment_receipts ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'legacy_unconfirmed' CHECK (evidence_kind IN ('legacy_unconfirmed', 'local_simulation', 'confirmed_onchain'));
-- signalarc:statement
ALTER TABLE payment_receipts ADD COLUMN authorization_key TEXT;
-- signalarc:statement
ALTER TABLE payment_receipts ADD COLUMN config_version TEXT;
-- signalarc:statement
ALTER TABLE payment_receipts ADD COLUMN config_hash TEXT;
-- signalarc:statement
ALTER TABLE analytics_events ADD COLUMN attempt_id TEXT REFERENCES payment_attempts(id);
-- signalarc:statement
ALTER TABLE analytics_events ADD COLUMN evidence_kind TEXT NOT NULL DEFAULT 'legacy_unconfirmed' CHECK (evidence_kind IN ('legacy_unconfirmed', 'local_simulation', 'confirmed_onchain'));
-- signalarc:statement
CREATE UNIQUE INDEX analytics_attempt_event ON analytics_events(attempt_id, event_type) WHERE attempt_id IS NOT NULL;
-- signalarc:statement
ALTER TABLE payment_receipts ADD COLUMN settlement_json TEXT CHECK (settlement_json IS NULL OR json_valid(settlement_json));
-- signalarc:statement
CREATE TRIGGER payment_initial_phase BEFORE INSERT ON payment_attempts
WHEN NEW.phase NOT IN ('created', 'legacy_unreconciled')
BEGIN
  SELECT RAISE(ABORT, 'invalid_initial_payment_phase');
END;
-- signalarc:statement
CREATE TRIGGER payment_identity_immutable BEFORE UPDATE OF authorization_key, authorization_fingerprint, buyer_address, resource_id, merchant_id, amount_atomic, network, recipient, asset, request_hash, url_hash, requirements_json, snapshot_hash, config_revision, binding_generation, config_version, config_hash ON payment_attempts
WHEN OLD.phase != 'created'
BEGIN
  SELECT RAISE(ABORT, 'claimed_payment_identity_is_immutable');
END;
