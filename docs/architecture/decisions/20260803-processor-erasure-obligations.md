# 20260803-processor-erasure-obligations — Record what erasure owes at the payment processor; never delete a Stripe customer on the shop's behalf

- **Status:** Accepted
- **Date:** 2026-08-03
- **Extends:** [20260802-diver-data-erasure](20260802-diver-data-erasure.md) (closes the first of
  its recorded residuals)

## Context

`anonymizeDiver` ([20260802-diver-data-erasure](20260802-diver-data-erasure.md), `src/db/anonymize.ts`)
empties every column DiveDay owns. It stops at one it does not: `orders.stripe_customer_id` is
`NOT NULL` and names a customer object living in the **shop's own** Stripe account, carrying the
diver's name and email. The ADR recorded this honestly and left it there:

> Erasure at the processor is a **separate, manual step** (deleting the Stripe customer) and is out
> of scope for this mechanism.

The 2026-08-02 review kept it open as finding **DATA-H1 (residue)**. The problem is not the
sentence, it is that the sentence was the entire mechanism: an obligation documented in an ADR, owed
by nobody in particular, with nothing in the product that knows it exists. A shop that erases a
diver on Tuesday has no way to discover on Friday that Stripe still holds them.

## Alternatives considered

### Delete or anonymize the Stripe customer through the API at erasure time — rejected

Attractive because it is automatic and needs no human. Rejected for three separate reasons, any one
of which is sufficient:

1. **It is irreversible and it is not our data.** A deleted Stripe customer cannot be restored, and
   the shop's own tax and chargeback position depends on those records. DiveDay would be making an
   irreversible decision inside the shop's financial account as a side effect of a button in a diver
   profile.
2. **It would not actually achieve erasure.** Stripe **snapshots** `customer_name` and
   `customer_email` onto an invoice when it is finalized. Deleting or renaming the customer object
   afterwards does not rewrite those finalized invoices, so the diver's identity survives at Stripe
   either way. An automated call would buy the *appearance* of processor-side erasure while leaving
   the actual copies in place — the worst possible outcome for a mechanism whose entire value is
   that a shop can rely on what it says.
3. **The complete answer is not an API call at all.** Removing identity from finalized invoices goes
   through Stripe's own data-deletion process, which is a request a *shop* makes about *its* account,
   not something a platform integration can perform for it.

### Leave it as prose in the erasure ADR — rejected

The status quo. It costs nothing and closes nothing: a shop cannot act on a paragraph it never
reads, and the gap is invisible at exactly the moment it matters (the day after an erasure).

### Record the obligation durably and surface it — chosen

The repo already has this shape:
`media_deletion_attempts` ([20260723-media-validation-and-deletion](20260723-media-validation-and-deletion.md))
is the durable "this object should no longer exist" record for blobs, and
`payment_operation_intents` ([20260723-payment-operation-intents](20260723-payment-operation-intents.md))
is the same idea for Stripe calls. Neither performs work the shop has not asked for; both make an
unfinished obligation visible and finishable.

## Decision

**A new table, `processor_erasure_obligations`, records one row per processor record an erasure
could not reach. Nothing in DiveDay ever calls Stripe about it.**

- **Raised inside the erasure transaction.** `anonymizeDiver` collects the distinct
  `orders.stripe_customer_id` values on the erased diver's orders and calls
  `recordProcessorErasureObligations` (`src/db/processor-erasure.ts`) before it commits. An
  obligation that only commits if some later step also succeeds is exactly the "we forgot we owed
  this" failure the ledger exists to prevent, and unlike a provider call there is no network here to
  keep out of the transaction. `AnonymizeDiverResult` gains `queuedProcessorErasures` so the caller
  can say the erasure is incomplete rather than discovering it later.
- **The row holds a pointer, not a person.** `external_id` is a `cus_…` handle — the string the shop
  pastes into its Stripe dashboard. No name, address, or amount: the identity is precisely what the
  erasure just removed, and re-recording it here to describe its own removal would be absurd.
  `person_id` points at the already-anonymized row, as provenance for *which* erasure still owes
  work.
- **Idempotent on `(shop_id, target, external_id)`.** A replayed erasure, or a second diver whose
  orders point at the same customer object, folds onto the existing row: the work owed is one delete
  either way. The uniqueness is per shop, because two Stripe accounts are two different places.
- **Discharged by a human, never by a job.** No cron drains this table and there is no retry. An
  owner works through the list at Stripe and marks each one done; `discharged_at` and
  `discharged_by_person_id` record who attested it, and a check constraint keeps `status` and
  `discharged_at` from disagreeing. The `status = 'owed'` predicate on the update makes a
  double-submit a no-op rather than a rewritten attestation.
- **Surfaced on the shop's reports page**, in the same warning-notice pattern as the stuck
  media-deletion and payment-operation panels — the place a shop already looks for "work the system
  could not finish."
- **Read behind the reports gate; discharged behind the erasure gate.** A manager who can read
  reports sees the outstanding work and cannot sign it off: declaring a diver's data gone from Stripe
  is an assertion only the role that could order the erasure may make (`canPersonErasePersonalData`).
- **Not exported.** Every row is a pointer into one Stripe account plus an attestation about work
  done there — meaningless in another system, the same reasoning as `shop_stripe_accounts`. An
  outstanding compliance obligation also has no business travelling into a bundle where nobody can
  discharge it.

## What this does not do

Stated plainly, because a compliance mechanism that overstates itself is worse than none:

- **It does not erase anything at Stripe.** It records that erasure is owed there. An undischarged
  row means the erasure is genuinely incomplete.
- **A discharged row is the shop's own attestation, not a verified fact.** DiveDay does not read
  back from Stripe to confirm the customer is gone, and cannot see the finalized invoices that keep
  their own snapshot of the name and email regardless.
- **It covers `stripe_customer_id` only.** `orders.stripe_invoice_id` points at those finalized
  invoices, which is the part no deletion at either end reaches — it is Stripe's data-deletion
  process or nothing, and that is outside any table here.
- **It is raised only from `anonymizeDiver`.** Orders written for a diver *after* an erasure (a
  nonsense state the erasure's soft-delete prevents in practice) would not raise one, and there is
  no back-fill for erasures performed before this table existed.

## Consequences

- One new table, two new enums, no new runtime dependency, and no new outbound network call — the
  ledger's whole point is that DiveDay does not make one.
- The erasure ADR's first residual moves from "a manual step nobody is tracking" to "a tracked
  obligation with an owner and a visible state". It does not become "erased at the processor", and
  nothing in the product may claim it does.
- Adding a second processor is an additive enum value plus a row shape that already fits.
- If Stripe ever exposes an API that genuinely removes identity from finalized invoices, this table
  is the right place to hang an automated discharge off — the obligation is already recorded; only
  who performs it would change.
