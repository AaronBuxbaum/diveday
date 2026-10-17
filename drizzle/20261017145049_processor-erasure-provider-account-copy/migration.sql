-- Issue #1721: the ledger's account column is now `provider_account_id`, so a
-- WhatsApp obligation can name the shop's number and a Stripe one its
-- connected account. Every row written before it is a Stripe row with its
-- account in `stripe_account_id`. This copies it across so those rows still
-- retry, and so the check constraint in the next migration (a Stripe target
-- names its account) can be added over them. DiveDay is pre-pilot (H-49):
-- this runs over seed and demo rows only.
UPDATE "processor_erasure_obligations"
SET "provider_account_id" = "stripe_account_id"
WHERE "provider_account_id" IS NULL
  AND "stripe_account_id" IS NOT NULL;
