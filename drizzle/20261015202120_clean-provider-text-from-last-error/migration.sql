-- Issue #2532: #2334 stopped provider free text reaching `last_error`; rows
-- written before it may still hold some (a Stripe message can quote the
-- customer or input it refused, a drained queue row a thrown error's message).
-- Erasure promises hold pre-pilot too (H-02), so the old rows are cleaned now
-- rather than waiting for a retry that a finished or abandoned row never gets.
--
-- An erasure ledger value survives only if it is exactly what a writer emits
-- today: `HTTP nnn`, optionally with Stripe's error code token, or one of the
-- fixed `ERASURE_FAILURE_DETAIL` sentences. Anything else is cut to its
-- `HTTP nnn` prefix when it has one, and to null when it does not.
UPDATE "processor_erasure_obligations"
SET "last_error" = substring("last_error" from '^HTTP [0-9]{3}')
WHERE "last_error" IS NOT NULL
  AND "last_error" !~ '^HTTP [0-9]{3}(: [a-z0-9_]{1,64})?$'
  AND "last_error" NOT IN (
    'stripe account not owned by this shop',
    'stripe not configured',
    'stripe did not report the customer deleted',
    'stripe request did not complete'
  );--> statement-breakpoint
-- A queue row that carries an `error_code` has said what went wrong in a
-- token; the free text beside it is the provider's own words.
UPDATE "notification_send_queue" SET "last_error" = NULL WHERE "error_code" IS NOT NULL AND "last_error" IS NOT NULL;
