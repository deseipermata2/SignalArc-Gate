-- Review-only evidence collected during local reconciliation.
-- These rows can never authorize a payment receipt or protected response.
CREATE TABLE settlement_evidence_observations (
  id TEXT PRIMARY KEY NOT NULL,
  attempt_id TEXT NOT NULL REFERENCES payment_attempts(id),
  merchant_id TEXT NOT NULL REFERENCES merchants(id),
  resource_id TEXT NOT NULL,
  authorization_key TEXT NOT NULL CHECK (length(authorization_key) = 64 AND authorization_key NOT GLOB '*[^0-9a-f]*'),
  authorization_fingerprint TEXT NOT NULL CHECK (length(authorization_fingerprint) = 64 AND authorization_fingerprint NOT GLOB '*[^0-9a-f]*'),
  network TEXT NOT NULL CHECK (network = 'eip155:8453'),
  asset TEXT NOT NULL CHECK (lower(asset) = '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913'),
  payer_address TEXT NOT NULL CHECK (length(payer_address) = 42),
  recipient_address TEXT NOT NULL CHECK (length(recipient_address) = 42),
  amount_atomic TEXT NOT NULL CHECK (length(amount_atomic) BETWEEN 1 AND 12 AND amount_atomic NOT GLOB '*[^0-9]*' AND substr(amount_atomic, 1, 1) BETWEEN '1' AND '9'),
  transaction_hash TEXT NOT NULL CHECK (
    length(transaction_hash) = 66 AND lower(substr(transaction_hash,1,2)) = '0x' AND
    substr(transaction_hash,3) NOT GLOB '*[^0-9a-fA-F]*' AND
    lower(transaction_hash) != '0x' || printf('%064d',0)
  ),
  provenance TEXT NOT NULL CHECK (provenance = 'local_simulation'),
  source_id TEXT NOT NULL CHECK (source_id = 'LOCAL_SIMULATION_ONLY'),
  observed_at INTEGER NOT NULL CHECK (typeof(observed_at) = 'integer' AND observed_at > 0),
  outcome TEXT NOT NULL CHECK (outcome IN ('rpc_observation_only','conflict')),
  evidence_json TEXT NOT NULL CHECK (
    json_valid(evidence_json) AND length(evidence_json) <= 16384 AND
    json_extract(evidence_json,'$.evidence') = 'rpc_observation_only' AND
    json_extract(evidence_json,'$.productionAdmitted') = 0 AND
    json_extract(evidence_json,'$.provenance') = 'LOCAL SIMULATION ONLY' AND
    json_extract(evidence_json,'$.authorizationKey') = authorization_key AND
    json_extract(evidence_json,'$.authorizationFingerprint') = authorization_fingerprint AND
    lower(json_extract(evidence_json,'$.transaction')) = lower(transaction_hash) AND
    lower(json_extract(evidence_json,'$.payer')) = lower(payer_address) AND
    lower(json_extract(evidence_json,'$.recipient')) = lower(recipient_address) AND
    json_extract(evidence_json,'$.amount') = amount_atomic AND
    json_extract(evidence_json,'$.network') = network AND
    lower(json_extract(evidence_json,'$.asset')) = lower(asset)
  ),
  FOREIGN KEY (resource_id, merchant_id) REFERENCES api_resources(id, merchant_id)
);
-- signalarc:statement
CREATE INDEX settlement_observation_attempt
  ON settlement_evidence_observations(attempt_id, observed_at, id);
-- signalarc:statement
CREATE TRIGGER settlement_observation_identity_guard BEFORE INSERT ON settlement_evidence_observations
WHEN NOT EXISTS (
  SELECT 1 FROM payment_attempts a
  WHERE a.id=NEW.attempt_id AND a.merchant_id=NEW.merchant_id
    AND a.resource_id=NEW.resource_id AND a.phase='settlement_unknown'
    AND a.evidence_kind='local_simulation'
    AND a.authorization_key=NEW.authorization_key
    AND a.authorization_fingerprint=NEW.authorization_fingerprint
    AND a.network=NEW.network AND lower(a.asset)=lower(NEW.asset)
    AND a.buyer_address=lower(NEW.payer_address)
    AND lower(a.recipient)=lower(NEW.recipient_address)
    AND a.amount_atomic=NEW.amount_atomic
)
BEGIN SELECT RAISE(ABORT,'settlement_observation_identity_mismatch'); END;
-- signalarc:statement
CREATE TRIGGER settlement_observation_no_update BEFORE UPDATE ON settlement_evidence_observations
BEGIN SELECT RAISE(ABORT,'settlement_observation_immutable'); END;
-- signalarc:statement
CREATE TRIGGER settlement_observation_no_delete BEFORE DELETE ON settlement_evidence_observations
BEGIN SELECT RAISE(ABORT,'settlement_observation_immutable'); END;
