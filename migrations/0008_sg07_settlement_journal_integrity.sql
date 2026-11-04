-- signalarc:statement
-- REPLACE may delete an existing row without firing its ordinary delete trigger.
-- A review conflict must never be overwritten under the same immutable journal ID.
-- No production evidence authority, payment state or receipt is introduced here.
CREATE TRIGGER settlement_observation_no_replace
BEFORE INSERT ON settlement_evidence_observations
WHEN EXISTS (SELECT 1 FROM settlement_evidence_observations prior WHERE prior.id=NEW.id)
BEGIN SELECT RAISE(ABORT,'settlement_observation_identity_replacement'); END;
