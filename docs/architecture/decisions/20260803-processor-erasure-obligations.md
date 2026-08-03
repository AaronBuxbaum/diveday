# 20260803-processor-erasure-obligations — Delete the diver's Stripe customer at erasure, and record the invoice snapshot no API can reach

- **Status:** Accepted
- **Date:** 2026-08-03
- **Extends:** [20260802-diver-data-erasure](20260802-diver-data-erasure.md) (closes the first of
  its recorded residuals)

## Context

`anonymizeDiver` ([20260802-diver-data-erasure](20260802-diver-data-erasure.md), `src/db/anonymize.ts`)
empties every column DiveDay owns. It stops at two it does not. `orders.stripe_customer_id` and
`orders.stripe_invoice_id` are both `NOT NULL` and both point into the **shop's own** Stripe
account, where the diver's name and email are still sitting. The erasure ADR recorded this and left
it there:

> Erasure at the processor is a **separate, manual step** (deleting the Stripe customer) and is out
> of scope for this mechanism.

The 2026-08-02 review kept it open as finding **DATA-H1 (residue)**. The problem was never the
sentence; it was that the sentence was the whole mechanism. An obligation documented in an ADR, owed
by nobody in particular, with nothing in the product that knows it exists, is not a mechanism. A
shop that erases a diver on Tuesday had no way to discover on Friday that Stripe still held them.

## Alternatives considered

### Never call Stripe; record the obligation and let the shop delete the customer — rejected

This was the first design, and it was rejected on a **wrong premise**, recorded here so nobody
re-derives it from intuition:

> "Deleting a Stripe customer is irreversible and takes the shop's tax and chargeback records with
> it, so it must be the shop's decision."

**That is not what `DELETE /v1/customers/{id}` does.** On Stripe's own documented behaviour:

- The delete removes the customer's **sensitive data** — card details and payment methods — and
  cancels any active subscriptions.
- Charges, invoices, refunds and disputes are **separate objects**. They are not destroyed. The
  shop's financial, tax and chargeback trail survives the delete intact.
- Unlike most objects, **a deleted customer can still be retrieved through the API** to track its
  history.
- DiveDay creates **no subscriptions** on connected accounts (verified across `src/lib/payments/`
  and `src/db/orders.ts`), so the cancel-subscriptions side effect does not apply to this product at
  all.

So the cost the first design was protecting against does not exist, and what it bought instead was
the weaker half of the job: a ledger that records an obligation and never discharges it. When the
mechanism *can* do the work, recording that it should have been done is not the honest option — it
is the lazy one.

### Delete the customer and stop there — rejected

The opposite error. Stripe snapshots `customer_name` and `customer_email` onto an invoice when the
invoice is **finalized**, and deleting the customer afterwards does not rewrite that copy. Stripe's
own data-deletion flow handles Invoice, PaymentIntent and Charge separately from Customer, which is
the same fact from the other side. A design that deleted the customer and declared erasure complete
would be claiming something false about data the shop still holds.

### Delete what can be deleted, record what cannot — chosen

Both halves, in one ledger, with the row saying which half it is.

## Decision

**`processor_erasure_obligations` records every Stripe record an erasure touches, and its `target`
decides whether DiveDay discharges it or a human does.**

### `stripe_customer` — DiveDay deletes it

- One row per distinct `orders.stripe_customer_id` on the erased diver's orders.
- `deleteCustomer` on a new provider seam (`src/lib/payments/customers.ts`) issues
  `DELETE /v1/customers/{id}` with a `Stripe-Account` header, fetch-based and injectable, exactly
  like `./invoicing.ts` and `./connect.ts`. `src/db/anonymize.ts` never touches `fetch`.
- The idempotency key follows the house shape (`idempotencyKeyFor(obligation.id, "customer-delete")`).
  Deletion is idempotent by construction, so the key buys convergence of a retried *attempt*, not
  correctness.
- The connected account travels **on the row**, snapshotted from `orders.stripe_account_id` rather
  than re-derived from the shop at retry time — the discipline `refundOrder` already uses. A shop
  that disconnects and reconnects gets a different account id, and a delete aimed at the current one
  would 404 forever against an object still sitting on the old one.
- A 404 is `already_deleted` and discharges the row: that is what a replayed delete looks like, and
  the desired end state holds.
- `not_configured` (no Stripe key) is a **failure**, not a discharge. A deployment that cannot reach
  Stripe has erased nothing there.

### `stripe_invoice_snapshot` — a human discharges it

- One row per distinct `orders.stripe_invoice_id`.
- Never retried, never called: there is no API behind it. It closes only when an owner attests they
  filed Stripe's data-deletion request. Its entire job is to stop the product implying erasure
  finished while a copy of the name and email sits on a finalized invoice.

### Ordering: the local scrub commits first, always

The obligation rows are written **inside** the erasure transaction — a row that only commits if some
later step also succeeds is exactly the "we forgot we owed this" failure a ledger exists to prevent.
The Stripe calls run **after** that transaction commits, and can never fail it. A Stripe outage, a
dead network or a revoked Connect token leaves an `owed` row with `attempts`/`last_error` on it; it
does not roll back an erasure a diver asked for. No network call happens inside the transaction.

### Retry, visibility, and scope

- **Nightly retry.** `retryPendingProcessorErasures` is a bounded cross-shop scan on the existing
  daily tick, mirroring `retryPendingMediaDeletions`
  ([20260723-media-validation-and-deletion](20260723-media-validation-and-deletion.md)), so a
  transient outage does not require a human to notice a panel. It touches `stripe_customer` rows
  only, and stops at `MAX_AUTOMATIC_DELETE_ATTEMPTS` — the cap ends the nightly Stripe call on a
  permanently broken delete, not the debt, which stays `owed` and visible forever.
- **Reports panel**, in the same warning-notice pattern as the stuck media-deletion and
  payment-operation panels. A customer row offers Retry; an invoice row offers only "mark done".
- **Read behind the reports gate; acted on behind the erasure gate.** Retrying makes a destructive
  call against the shop's Stripe account and discharging asserts a diver's data is gone, so both
  need `canPersonErasePersonalData`. A manager who can read reports sees the outstanding work and
  can neither fire the delete nor sign it off.
- **Idempotent on `(shop_id, target, external_id)`,** per shop, because two Stripe accounts are two
  different places.
- **The row holds a pointer, not a person.** `external_id` is a `cus_…`/`in_…` handle. No name,
  address or amount — the identity is precisely what the erasure removed.
- **Not exported.** Every row is a pointer into one Stripe account plus an attestation about work
  done there, meaningless elsewhere — the same reasoning as `shop_stripe_accounts`. An outstanding
  compliance obligation also has no business travelling into a bundle where nobody can discharge it.

## What this does not do

Stated plainly, because a compliance mechanism that overstates itself is worse than none:

- **It does not erase the diver from finalized invoices.** That is the `stripe_invoice_snapshot`
  residue, and it needs a data-deletion request to Stripe. An undischarged row means the erasure is
  genuinely incomplete.
- **A discharged `stripe_invoice_snapshot` row is the shop's attestation, not a verified fact.**
  DiveDay does not read anything back from Stripe to confirm it.
- **It does not reach a customer object no order points at.** Orders are the only handle; a Stripe
  customer created outside this product is outside this mechanism.
- **It is raised only from `anonymizeDiver`,** with no back-fill for erasures performed before this
  table existed.

## Consequences

- One new table, two new enums, one new provider seam, and one new outbound Stripe call. No new
  runtime dependency.
- Diver erasure now *does* the processor-side work it can do, and names the part it cannot. The
  erasure ADR's first residual narrows from "an untracked manual step covering everything at Stripe"
  to "the invoice snapshot, tracked, with an owner and a visible state".
- A second processor is an additive enum value on a row shape that already fits.
- If Stripe ever exposes an API that clears a finalized invoice's identity snapshot, the
  `stripe_invoice_snapshot` rows become retryable the same way the customer rows already are — the
  obligation is already recorded; only who performs it would change.
