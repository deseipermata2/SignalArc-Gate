-- signalarc:statement
-- Query indexes only. No record, provenance or historic migration is rewritten.
CREATE INDEX payment_attempts_reporting ON payment_attempts(merchant_id, created_at DESC, id DESC);
-- signalarc:statement
CREATE INDEX payment_receipts_reporting ON payment_receipts(created_at DESC, id DESC, attempt_id);
