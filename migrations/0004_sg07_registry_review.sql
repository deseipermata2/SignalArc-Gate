-- signalarc:statement
-- Review watermarks are explicitly untrusted. They are never confirmed block metadata.
ALTER TABLE resource_registry_bindings ADD COLUMN review_block_number TEXT;
-- signalarc:statement
ALTER TABLE resource_registry_bindings ADD COLUMN review_block_hash TEXT;
-- signalarc:statement
ALTER TABLE resource_registry_bindings ADD COLUMN review_registry_address TEXT;
-- signalarc:statement
ALTER TABLE resource_registry_bindings ADD COLUMN review_code_hash TEXT;
-- signalarc:statement
ALTER TABLE resource_registry_bindings ADD COLUMN review_conflicted INTEGER NOT NULL DEFAULT 0 CHECK (review_conflicted IN (0,1));
-- signalarc:statement
CREATE TABLE registry_evidence_journal (
  id TEXT PRIMARY KEY NOT NULL,
  kind TEXT NOT NULL CHECK (kind IN ('observation','binding_revision','resource_revision')),
  resource_id TEXT NOT NULL,
  observed_at INTEGER NOT NULL,
  provenance TEXT NOT NULL CHECK (provenance IN ('local_simulation','untrusted_rpc','database_history')),
  source_id TEXT NOT NULL,
  resource_revision INTEGER,
  binding_generation INTEGER,
  registry_address TEXT,
  runtime_code_hash TEXT,
  block_number TEXT,
  block_hash TEXT,
  payload_json TEXT NOT NULL CHECK (json_valid(payload_json) AND length(payload_json) <= 16384),
  outcome TEXT NOT NULL CHECK (outcome IN ('history','review_only','rejected','rpc_failure','raced','replay','conflict'))
);
-- signalarc:statement
CREATE INDEX registry_review_history ON registry_evidence_journal(resource_id, observed_at, id);
-- signalarc:statement
CREATE TRIGGER registry_history_no_update BEFORE UPDATE ON registry_evidence_journal BEGIN SELECT RAISE(ABORT,'registry_history_immutable'); END;
-- signalarc:statement
CREATE TRIGGER registry_history_no_delete BEFORE DELETE ON registry_evidence_journal BEGIN SELECT RAISE(ABORT,'registry_history_immutable'); END;
-- signalarc:statement
CREATE TRIGGER registry_no_confirmation_insert BEFORE INSERT ON resource_registry_bindings WHEN NEW.source = 'onchain_confirmed'
BEGIN SELECT RAISE(ABORT,'production_registry_admission_disabled'); END;
-- signalarc:statement
CREATE TRIGGER registry_no_confirmation_update BEFORE UPDATE OF source ON resource_registry_bindings WHEN NEW.source = 'onchain_confirmed'
BEGIN SELECT RAISE(ABORT,'production_registry_admission_disabled'); END;
-- signalarc:statement
CREATE TRIGGER registry_generation_monotonic BEFORE UPDATE OF generation ON resource_registry_bindings WHEN NEW.generation != OLD.generation + 1
BEGIN SELECT RAISE(ABORT,'registry_generation_must_advance'); END;
-- signalarc:statement
CREATE TRIGGER resource_revision_monotonic BEFORE UPDATE OF payment_revision ON api_resources WHEN NEW.payment_revision != OLD.payment_revision + 1
BEGIN SELECT RAISE(ABORT,'resource_revision_must_advance'); END;
-- signalarc:statement
CREATE TRIGGER registry_identity_immutable BEFORE UPDATE OF resource_id,original_owner,onchain_resource_id ON resource_registry_bindings
WHEN NEW.resource_id != OLD.resource_id OR NEW.original_owner != OLD.original_owner OR NEW.onchain_resource_id != OLD.onchain_resource_id
BEGIN SELECT RAISE(ABORT,'registry_namespace_immutable'); END;
-- signalarc:statement
CREATE TRIGGER registry_conflict_sticky BEFORE UPDATE OF review_conflicted ON resource_registry_bindings WHEN OLD.review_conflicted=1 AND NEW.review_conflicted!=1
BEGIN SELECT RAISE(ABORT,'registry_conflict_requires_reviewed_resolution'); END;
-- signalarc:statement
CREATE TRIGGER registry_history_insert AFTER INSERT ON resource_registry_bindings
BEGIN
  UPDATE api_resources SET payment_revision = payment_revision + 1 WHERE id = NEW.resource_id;
  INSERT INTO registry_evidence_journal SELECT lower(hex(randomblob(16))),'binding_revision',NEW.resource_id,unixepoch()*1000,'database_history','binding_insert',r.payment_revision,NEW.generation,NEW.registry_address,NULL,NEW.block_number,NEW.block_hash,json_object('source',NEW.source,'originalOwner',NEW.original_owner,'id',NEW.onchain_resource_id,'version',NEW.registry_version,'configHash',NEW.config_hash),'history' FROM api_resources r WHERE r.id = NEW.resource_id;
END;
-- signalarc:statement
CREATE TRIGGER registry_history_delete AFTER DELETE ON resource_registry_bindings
BEGIN
  UPDATE api_resources SET payment_revision = payment_revision + 1 WHERE id = OLD.resource_id;
  INSERT INTO registry_evidence_journal SELECT lower(hex(randomblob(16))),'binding_revision',OLD.resource_id,unixepoch()*1000,'database_history','binding_delete',r.payment_revision,OLD.generation,OLD.registry_address,NULL,OLD.block_number,OLD.block_hash,json_object('source',OLD.source,'originalOwner',OLD.original_owner,'id',OLD.onchain_resource_id,'version',OLD.registry_version,'configHash',OLD.config_hash),'history' FROM api_resources r WHERE r.id = OLD.resource_id;
END;
-- signalarc:statement
CREATE TRIGGER registry_history_change AFTER UPDATE OF original_owner,onchain_resource_id,registry_address,config_salt,config_hash,registry_version,source,block_hash,block_number,checked_at ON resource_registry_bindings
BEGIN
  INSERT INTO registry_evidence_journal SELECT lower(hex(randomblob(16))),'binding_revision',NEW.resource_id,unixepoch()*1000,'database_history','binding_update',r.payment_revision,OLD.generation+1,NEW.registry_address,NULL,NEW.block_number,NEW.block_hash,json_object('previousSource',OLD.source,'source',NEW.source,'originalOwner',NEW.original_owner,'id',NEW.onchain_resource_id,'version',NEW.registry_version,'configHash',NEW.config_hash),'history' FROM api_resources r WHERE r.id = NEW.resource_id;
END;
-- signalarc:statement
CREATE TRIGGER registry_resource_revision AFTER UPDATE OF payment_revision ON api_resources
BEGIN
  INSERT INTO registry_evidence_journal VALUES (lower(hex(randomblob(16))),'resource_revision',NEW.id,unixepoch()*1000,'database_history','resource_update',NEW.payment_revision,NULL,NULL,NULL,NULL,NULL,json_object('merchantId',NEW.merchant_id,'owner',(SELECT wallet_address FROM merchants WHERE id=NEW.merchant_id),'priceAtomic',NEW.price_atomic,'payout',NEW.payout_address,'enabled',NEW.enabled,'previousRevision',OLD.payment_revision),'history');
  UPDATE resource_registry_bindings SET source='unconfirmed' WHERE resource_id=NEW.id AND source='onchain_confirmed';
END;
-- signalarc:statement
CREATE TRIGGER registry_merchant_owner_changed AFTER UPDATE OF wallet_address ON merchants WHEN NEW.wallet_address != OLD.wallet_address
BEGIN UPDATE api_resources SET payment_revision = payment_revision + 1 WHERE merchant_id=NEW.id; END;
-- signalarc:statement
-- Preserve pre-existing binding claims as history, including legacy claims of confirmation.
INSERT INTO registry_evidence_journal SELECT lower(hex(randomblob(16))),'binding_revision',b.resource_id,unixepoch()*1000,'database_history','migration_baseline',r.payment_revision,b.generation,b.registry_address,NULL,b.block_number,b.block_hash,json_object('sourceClaim',b.source,'originalOwner',b.original_owner,'id',b.onchain_resource_id,'version',b.registry_version,'configHash',b.config_hash,'trusted',0),'history' FROM resource_registry_bindings b JOIN api_resources r ON r.id=b.resource_id;
-- signalarc:statement
UPDATE resource_registry_bindings SET source='unconfirmed' WHERE source='onchain_confirmed';
-- signalarc:statement
-- Invalidation and watermark movement are in the same D1 transaction as the immutable observation.
CREATE TRIGGER registry_review_invalidate AFTER INSERT ON registry_evidence_journal
WHEN NEW.kind='observation' AND NEW.outcome IN ('review_only','rejected','rpc_failure','conflict')
BEGIN
  UPDATE resource_registry_bindings SET source='unconfirmed',
    review_conflicted=CASE WHEN NEW.outcome='conflict' THEN 1 ELSE review_conflicted END,
    review_block_number=CASE WHEN NEW.outcome='review_only' THEN NEW.block_number ELSE review_block_number END,
    review_block_hash=CASE WHEN NEW.outcome='review_only' THEN NEW.block_hash ELSE review_block_hash END,
    review_registry_address=CASE WHEN NEW.outcome='review_only' THEN NEW.registry_address ELSE review_registry_address END,
    review_code_hash=CASE WHEN NEW.outcome='review_only' THEN NEW.runtime_code_hash ELSE review_code_hash END
  WHERE resource_id=NEW.resource_id AND generation=NEW.binding_generation
    AND EXISTS (SELECT 1 FROM api_resources r WHERE r.id=NEW.resource_id AND r.payment_revision=NEW.resource_revision);
END;
