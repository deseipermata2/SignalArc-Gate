-- signalarc:statement
-- Conflict history is the durable gate. No automatic resolution or cross-resource taint.
CREATE INDEX registry_unresolved_conflicts ON registry_evidence_journal(resource_id)
WHERE kind='observation' AND outcome='conflict';
-- signalarc:statement
-- Preserve a legacy sticky flag even if no observation recorded its origin.
INSERT INTO registry_evidence_journal
SELECT lower(hex(randomblob(16))),'observation',b.resource_id,unixepoch()*1000,
 'database_history','quarantine_flag_backfill',r.payment_revision,b.generation,
 b.review_registry_address,b.review_code_hash,b.review_block_number,b.review_block_hash,
 json_object('productionAdmitted',json('false'),'legacyQuarantineFlag',1,'originalOwner',b.original_owner,'onchainResourceId',b.onchain_resource_id),'conflict'
FROM resource_registry_bindings b JOIN api_resources r ON r.id=b.resource_id
WHERE b.review_conflicted=1 AND NOT EXISTS (
 SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=b.resource_id AND j.kind='observation' AND j.outcome='conflict'
);
-- signalarc:statement
CREATE TRIGGER registry_quarantine_recreated AFTER INSERT ON resource_registry_bindings
WHEN EXISTS (SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=NEW.resource_id AND j.kind='observation' AND j.outcome='conflict')
BEGIN
 UPDATE resource_registry_bindings SET source='unconfirmed',review_conflicted=1
 WHERE resource_id=NEW.resource_id AND (source!='unconfirmed' OR review_conflicted!=1);
END;
-- signalarc:statement
CREATE TRIGGER registry_quarantine_guard BEFORE UPDATE ON resource_registry_bindings
WHEN (NEW.source!='unconfirmed' OR NEW.review_conflicted!=1) AND EXISTS (
 SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=NEW.resource_id AND j.kind='observation' AND j.outcome='conflict'
)
BEGIN SELECT RAISE(ABORT,'historical_registry_conflict_unresolved'); END;
-- signalarc:statement
CREATE TRIGGER registry_quarantine_history AFTER INSERT ON registry_evidence_journal
WHEN NEW.kind='observation' AND NEW.outcome='conflict'
BEGIN
 UPDATE resource_registry_bindings SET source='unconfirmed',review_conflicted=1
 WHERE resource_id=NEW.resource_id AND (source!='unconfirmed' OR review_conflicted!=1);
END;
-- signalarc:statement
-- Repair active rows recreated before this correction. Keep every original journal row and receipt.
UPDATE resource_registry_bindings SET source='unconfirmed',review_conflicted=1
WHERE (source!='unconfirmed' OR review_conflicted!=1) AND EXISTS (
 SELECT 1 FROM registry_evidence_journal j WHERE j.resource_id=resource_registry_bindings.resource_id AND j.kind='observation' AND j.outcome='conflict'
);
