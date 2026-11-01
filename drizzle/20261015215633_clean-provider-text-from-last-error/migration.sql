-- Issue #2532: #2334 stopped provider free text reaching `last_error`; rows
-- written before it may still hold some (a Stripe message can quote the
-- customer or input it refused, a drained queue row a thrown error's message).
-- Erasure promises hold pre-pilot too (H-20260730-evidence-retention-period-deletion), so the old rows are cleaned now
-- rather than waiting for a retry that a finished or abandoned row never gets.
--
-- An erasure ledger value survives only if it is exactly what a writer emits
-- today: `HTTP nnn`, optionally with Stripe's error code token, or one of the
-- fixed `ERASURE_FAILURE_DETAIL` sentences. Anything else is cut to its
-- `HTTP nnn` prefix when it has one, and to the fixed "request did not complete"
-- sentence when it does not (so `erasureFailureOf` still reads it as
-- unreachable rather than losing the reason).
UPDATE "processor_erasure_obligations"
SET "last_error" = coalesce(
  substring("last_error" from '^HTTP [0-9]{3}'),
  'stripe request did not complete'
)
WHERE "last_error" IS NOT NULL
  AND "last_error" !~ '^HTTP [0-9]{3}(: [a-z0-9_]{1,64})?$'
  AND "last_error" NOT IN (
    'stripe account not owned by this shop',
    'stripe not configured',
    'stripe did not report the customer deleted',
    'stripe request did not complete'
  );--> statement-breakpoint
-- A queue row's `last_error` is a class name or a driver code today (see
-- `errorClassToken`). Keep a value of exactly that shape; whatever else is
-- there is the provider's or a thrown error's own words. Selected by shape, not
-- by `error_code`, which an old row may not have.
UPDATE "notification_send_queue" SET "last_error" = NULL
WHERE "last_error" IS NOT NULL
  AND "last_error" !~ '^[A-Za-z][A-Za-z0-9_]{0,63}$'
  AND "last_error" !~ '^[A-Z0-9_]{1,32}$';
