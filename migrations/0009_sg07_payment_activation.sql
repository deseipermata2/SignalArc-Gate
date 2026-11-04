-- signalarc:statement
-- Operator approval is permission to observe an exact resource, NOT proof of payment.
CREATE TABLE payment_manifests (
  resource_id TEXT PRIMARY KEY NOT NULL REFERENCES api_resources(id),
  merchant_id TEXT NOT NULL,
  policy_id TEXT NOT NULL CHECK(policy_id='base-finalized-internal-json-v1'),
  handler TEXT NOT NULL CHECK(handler='signalarc.resource-configuration.v1'),
  realm TEXT NOT NULL CHECK(realm IN ('operator_rpc','local_simulation')),
  owner TEXT NOT NULL, original_owner TEXT NOT NULL,
  onchain_resource_id TEXT NOT NULL, registry_address TEXT NOT NULL, runtime_code_hash TEXT NOT NULL,
  config_hash TEXT NOT NULL, registry_version TEXT NOT NULL,
  resource_revision INTEGER NOT NULL, binding_generation INTEGER NOT NULL,
  amount_atomic TEXT NOT NULL, recipient TEXT NOT NULL,
  approved_at INTEGER NOT NULL, expires_at INTEGER NOT NULL CHECK(expires_at>approved_at),
  revoked_at INTEGER,
  FOREIGN KEY(resource_id,merchant_id) REFERENCES api_resources(id,merchant_id)
);
-- signalarc:statement
CREATE TRIGGER payment_manifest_no_replace BEFORE INSERT ON payment_manifests WHEN EXISTS(SELECT 1 FROM payment_manifests WHERE resource_id=NEW.resource_id) BEGIN SELECT RAISE(ABORT,'manifest_identity_exists'); END;
-- signalarc:statement
CREATE TRIGGER payment_manifest_no_delete BEFORE DELETE ON payment_manifests BEGIN SELECT RAISE(ABORT,'manifest_history_permanent'); END;
-- signalarc:statement
CREATE TRIGGER payment_manifest_immutable BEFORE UPDATE ON payment_manifests WHEN NEW.resource_id!=OLD.resource_id OR NEW.merchant_id!=OLD.merchant_id OR NEW.policy_id!=OLD.policy_id OR NEW.handler!=OLD.handler OR NEW.realm!=OLD.realm OR NEW.owner!=OLD.owner OR NEW.original_owner!=OLD.original_owner OR NEW.onchain_resource_id!=OLD.onchain_resource_id OR NEW.registry_address!=OLD.registry_address OR NEW.runtime_code_hash!=OLD.runtime_code_hash OR NEW.config_hash!=OLD.config_hash OR NEW.registry_version!=OLD.registry_version OR NEW.resource_revision!=OLD.resource_revision OR NEW.binding_generation!=OLD.binding_generation OR NEW.amount_atomic!=OLD.amount_atomic OR NEW.recipient!=OLD.recipient OR NEW.approved_at!=OLD.approved_at OR NEW.expires_at!=OLD.expires_at OR (OLD.revoked_at IS NOT NULL AND NEW.revoked_at IS NOT OLD.revoked_at) BEGIN SELECT RAISE(ABORT,'manifest_immutable'); END;
-- signalarc:statement
CREATE TRIGGER payment_manifest_resource_change AFTER UPDATE ON api_resources BEGIN UPDATE payment_manifests SET revoked_at=COALESCE(revoked_at,NEW.updated_at) WHERE resource_id=NEW.id AND resource_revision!=NEW.payment_revision; END;
-- signalarc:statement
CREATE TRIGGER payment_manifest_binding_change AFTER UPDATE ON resource_registry_bindings BEGIN UPDATE payment_manifests SET revoked_at=COALESCE(revoked_at,unixepoch()*1000) WHERE resource_id=NEW.resource_id AND binding_generation!=NEW.generation; END;
-- signalarc:statement
CREATE TRIGGER payment_manifest_binding_delete AFTER DELETE ON resource_registry_bindings BEGIN UPDATE payment_manifests SET revoked_at=COALESCE(revoked_at,unixepoch()*1000) WHERE resource_id=OLD.resource_id; END;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN activation_realm TEXT CHECK(activation_realm IN ('operator_rpc','local_simulation'));
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN authorization_nonce TEXT;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN delivery_claims INTEGER NOT NULL DEFAULT 0;
-- signalarc:statement
ALTER TABLE payment_attempts ADD COLUMN submission_started_at INTEGER;
-- signalarc:statement
CREATE TRIGGER payment_submission_started_immutable BEFORE UPDATE OF submission_started_at ON payment_attempts WHEN OLD.submission_started_at IS NOT NULL BEGIN SELECT RAISE(ABORT,'submission_claim_permanent'); END;
-- signalarc:statement
CREATE TRIGGER payment_activation_identity BEFORE UPDATE OF activation_realm,authorization_nonce ON payment_attempts WHEN OLD.phase!='created' OR NEW.activation_realm IS NOT OLD.activation_realm BEGIN SELECT RAISE(ABORT,'activation_identity_immutable'); END;
-- signalarc:statement
CREATE TABLE payment_submission_reports (
  attempt_id TEXT PRIMARY KEY NOT NULL REFERENCES payment_attempts(id),
  realm TEXT NOT NULL CHECK(realm IN ('operator_rpc','local_simulation')),
  authorization_key TEXT NOT NULL, authorization_fingerprint TEXT NOT NULL,
  transaction_hash TEXT, disposition TEXT NOT NULL CHECK(disposition IN ('reported_settled','unknown')),
  reported_at INTEGER NOT NULL,
  CHECK(transaction_hash IS NULL OR (length(transaction_hash)=66 AND transaction_hash GLOB '0x*'))
);
-- signalarc:statement
CREATE TRIGGER submission_report_guard BEFORE INSERT ON payment_submission_reports WHEN NOT EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=NEW.attempt_id AND a.activation_realm=NEW.realm AND a.authorization_key=NEW.authorization_key AND a.authorization_fingerprint=NEW.authorization_fingerprint AND a.phase IN ('settlement_pending','settlement_unknown') AND a.submission_started_at IS NOT NULL) BEGIN SELECT RAISE(ABORT,'submission_identity_mismatch'); END;
-- signalarc:statement
CREATE TRIGGER submission_report_no_replace BEFORE INSERT ON payment_submission_reports WHEN EXISTS(SELECT 1 FROM payment_submission_reports WHERE attempt_id=NEW.attempt_id) BEGIN SELECT RAISE(ABORT,'submission_report_exists'); END;
-- signalarc:statement
CREATE TRIGGER submission_report_no_update BEFORE UPDATE ON payment_submission_reports BEGIN SELECT RAISE(ABORT,'submission_report_immutable'); END;
-- signalarc:statement
CREATE TRIGGER submission_report_no_delete BEFORE DELETE ON payment_submission_reports BEGIN SELECT RAISE(ABORT,'submission_report_permanent'); END;
-- signalarc:statement
CREATE TABLE payment_chain_evidence (
  id TEXT PRIMARY KEY NOT NULL,
  scope TEXT NOT NULL CHECK(scope IN ('registry','settlement')),
  scope_id TEXT NOT NULL,
  realm TEXT NOT NULL CHECK(realm IN ('operator_rpc','local_simulation')),
  identity_json TEXT NOT NULL CHECK(json_valid(identity_json)),
  finalized_number TEXT NOT NULL, finalized_hash TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  evidence_json TEXT NOT NULL CHECK(json_valid(evidence_json))
);
-- signalarc:statement
CREATE INDEX payment_chain_evidence_scope ON payment_chain_evidence(scope,scope_id,observed_at);
-- signalarc:statement
CREATE TRIGGER chain_evidence_no_replace BEFORE INSERT ON payment_chain_evidence WHEN EXISTS(SELECT 1 FROM payment_chain_evidence WHERE id=NEW.id) BEGIN SELECT RAISE(ABORT,'evidence_identity_exists'); END;
-- signalarc:statement
CREATE TRIGGER chain_evidence_no_update BEFORE UPDATE ON payment_chain_evidence BEGIN SELECT RAISE(ABORT,'chain_evidence_immutable'); END;
-- signalarc:statement
CREATE TRIGGER chain_evidence_no_delete BEFORE DELETE ON payment_chain_evidence BEGIN SELECT RAISE(ABORT,'chain_evidence_permanent'); END;
-- signalarc:statement
CREATE TABLE payment_quarantine (scope TEXT NOT NULL,scope_id TEXT NOT NULL,reason TEXT NOT NULL,created_at INTEGER NOT NULL,PRIMARY KEY(scope,scope_id));
-- signalarc:statement
CREATE TRIGGER payment_quarantine_no_replace BEFORE INSERT ON payment_quarantine WHEN EXISTS(SELECT 1 FROM payment_quarantine WHERE scope=NEW.scope AND scope_id=NEW.scope_id) BEGIN SELECT RAISE(ABORT,'quarantine_permanent'); END;
-- signalarc:statement
CREATE TRIGGER payment_quarantine_no_update BEFORE UPDATE ON payment_quarantine BEGIN SELECT RAISE(ABORT,'quarantine_permanent'); END;
-- signalarc:statement
CREATE TRIGGER payment_quarantine_no_delete BEFORE DELETE ON payment_quarantine BEGIN SELECT RAISE(ABORT,'quarantine_permanent'); END;
-- signalarc:statement
-- Only known delivery failures may retry; no transition can repeat settlement.
DROP TRIGGER payment_phase_transitions;
-- signalarc:statement
CREATE TRIGGER payment_phase_transitions BEFORE UPDATE OF phase ON payment_attempts WHEN OLD.phase!=NEW.phase AND NOT (
 (OLD.phase='created' AND NEW.phase IN ('verifying','rejected','failed')) OR
 (OLD.phase='verifying' AND NEW.phase IN ('verified','rejected','failed')) OR
 (OLD.phase='verified' AND NEW.phase IN ('settlement_pending','failed')) OR
 (OLD.phase='settlement_pending' AND NEW.phase IN ('settled','failed','settlement_unknown')) OR
 (OLD.phase='settlement_unknown' AND NEW.phase IN ('settled','failed')) OR
 (OLD.phase='settled' AND NEW.phase IN ('fulfilling','fulfillment_failed')) OR
 (OLD.phase='fulfilling' AND NEW.phase IN ('fulfilled','fulfillment_failed')) OR
 (OLD.phase='fulfillment_failed' AND NEW.phase='fulfilling' AND OLD.activation_realm IS NOT NULL AND OLD.delivery_claims<3 AND EXISTS(SELECT 1 FROM payment_receipts p WHERE p.attempt_id=OLD.id))
) BEGIN SELECT RAISE(ABORT,'invalid_payment_phase_transition'); END;
-- signalarc:statement
CREATE TRIGGER activation_receipt_guard BEFORE INSERT ON payment_receipts WHEN EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=NEW.attempt_id AND a.activation_realm IS NOT NULL) AND NOT EXISTS(
 SELECT 1 FROM payment_attempts a JOIN payment_chain_evidence e ON e.scope='settlement' AND e.scope_id=a.id AND e.realm=a.activation_realm
 WHERE a.id=NEW.attempt_id AND a.phase='settled' AND NEW.evidence_kind=CASE a.activation_realm WHEN 'operator_rpc' THEN 'confirmed_onchain' ELSE 'local_simulation' END
 AND NEW.authorization_key=a.authorization_key AND NEW.network=a.network AND NEW.amount_atomic=a.amount_atomic AND lower(NEW.payer_address)=lower(a.buyer_address) AND lower(NEW.payout_address)=lower(a.recipient)
 AND lower(json_extract(e.identity_json,'$.transaction'))=lower(NEW.transaction_hash) AND json_extract(e.identity_json,'$.authorizationKey')=a.authorization_key AND json_extract(e.identity_json,'$.fingerprint')=a.authorization_fingerprint AND json_extract(e.identity_json,'$.nonce')=a.authorization_nonce
 AND json_extract(e.identity_json,'$.blockNumber')=NEW.block_number
 AND NOT EXISTS(SELECT 1 FROM payment_quarantine q WHERE q.scope='settlement' AND q.scope_id=a.id)
) BEGIN SELECT RAISE(ABORT,'receipt_evidence_mismatch'); END;
-- signalarc:statement
CREATE TRIGGER activation_receipt_no_update BEFORE UPDATE ON payment_receipts WHEN EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=OLD.attempt_id AND a.activation_realm IS NOT NULL) BEGIN SELECT RAISE(ABORT,'activation_receipt_immutable'); END;
-- signalarc:statement
CREATE TRIGGER activation_receipt_no_delete BEFORE DELETE ON payment_receipts WHEN EXISTS(SELECT 1 FROM payment_attempts a WHERE a.id=OLD.attempt_id AND a.activation_realm IS NOT NULL) BEGIN SELECT RAISE(ABORT,'activation_receipt_permanent'); END;
