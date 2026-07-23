# 20260723-payment-operation-intents — Durable, idempotent payment operations

- **Status:** Accepted
- **Date:** 2026-07-23

## Context

[The 2026-07-23 codebase review](../../product/assessments/codebase-review-20260723.md) (CR-005)
found that `startBookingCheckout`, `createOrder`, and `refundOrder` call Stripe *before* any durable
local row exists to describe the attempt — the local `booking_checkouts`/`orders` insert only
happens after Stripe responds. A crash between the two leaves a real Stripe object (a Checkout
session, an invoice, a refund) with zero local trace: nothing to reconcile against, nothing an owner
can see went wrong. Two concurrent `startBookingCheckout` calls for the same booking (a double
submit, two open tabs) could also both pass the "no existing checkout" read and both mint a Stripe
session for the same seat, since nothing enforced exclusivity between the check and the call. Only
one Stripe call in the whole payments seam (`refundCheckoutSession`) carried a deterministic
`Idempotency-Key`; every other call — session creation, invoice creation's four-step chain, invoice
refund — had none, so a retried request after a lost response could create a second Stripe object
instead of converging on the first.

## Decision

- **`payment_operation_intents` is the durable pre-call record.** One row per attempted Stripe side
  effect (`checkout_session`, `invoice`, `refund`), written and committed *before* the Stripe call,
  independent of the transaction that will later hold the local `orders`/`booking_checkouts`/
  `booking_payments` write — that transaction can't exist yet (nothing local is known until Stripe
  responds), and a row that only commits alongside a later write isn't durable against a crash
  between the two. `startPaymentOperation`/`resolvePaymentOperation` (`src/db/payment-operations.ts`)
  are the only way to create/close one.
- **The intent's own id is the idempotency-key source.** `idempotencyKeyFor(intentId, step?)`
  produces a deterministic `Idempotency-Key` for every Stripe-mutating call — the create-checkout
  POST, each of invoice creation's four steps (customer/invoiceitem(s)/invoice/finalize, each with
  its own `:step` suffix since each is a separate Stripe idempotency scope), and invoice refund
  (checkout refund already had its own deterministic key derived from the payment intent + amount,
  which is left as-is — equally deterministic, just not intent-id-based). A retry of the same
  logical attempt — a lost response, a redeployed process resuming where a crashed one left off —
  always sends the same key, so Stripe itself collapses the retry onto the object it already
  created instead of minting a second one.
- **`bookings.pending_checkout_intent_id` is an atomic claim, not a lock held across the Stripe
  call.** `claimBookingsForCheckout` conditionally claims every booking a checkout attempt covers
  (`UPDATE ... WHERE pending_checkout_intent_id IS NULL`) in one short transaction that commits
  *before* Stripe is called; `releaseBookingCheckoutClaim` clears it once the attempt resolves,
  win or lose. A second concurrent attempt covering an overlapping booking can't also claim it, so
  it can't also reach Stripe. Not a real DB unique constraint — deliberately a plain `uuid` column,
  not a typed foreign key, because `payment_operation_intents.booking_id` already references
  `bookings.id` in the other direction and drizzle can't type two tables whose FKs point at each
  other.
- **A claim self-heals instead of being a permanent lock.** `claimBookingsForCheckout` first frees
  any booking held by an intent old enough (five minutes, `STALE_AFTER_MS`) to be considered
  abandoned — a crashed process that claimed a booking and never released it must not block that
  seat's payment forever. This is the same trade-off `bookings.ts`'s trip-capacity `FOR UPDATE`
  lock makes for a different invariant: a short window of imperfect exclusivity in exchange for
  never wedging.
- **`listStuckPaymentOperations` is the reconciliation read** — intents still `started` past that
  same staleness window, batched-joined to the trip/person context a human needs to go check the
  Stripe dashboard and finish the operation by hand. Surfaced on the owner Reports page (already
  owner/manager-gated, already the revenue-adjacent surface) as a "needs reconciliation" panel above
  the month view — deliberately not folded into the Today queue, which assumes every action belongs
  to a specific upcoming trip departure; an order or refund intent may have no trip at all.

## Alternatives considered

- **Hold a `FOR UPDATE` lock on the trip row for the whole `startBookingCheckout` call, including
  the Stripe HTTP round trip** — mirrors the existing capacity-lock pattern exactly, but holding a
  Postgres row lock open across an external network call is the anti-pattern that pattern
  deliberately avoids elsewhere; a slow or hung Stripe response would hold the lock, not just the
  attempt. The claim-column approach gets the same exclusivity without an open transaction spanning
  the network call.
- **A real unique constraint enforcing "at most one active claim per booking"** instead of a plain
  conditional `UPDATE` — would need either a partial unique index whose predicate reaches into a
  joined table (not expressible in Postgres) or denormalizing checkout status onto the join table.
  The conditional `UPDATE ... WHERE pending_checkout_intent_id IS NULL` already gets the same
  atomicity from Postgres's standard row-locking on the rows it touches, without the extra schema
  surface.
- **Automatic reconciliation** (retry the Stripe call, or auto-resolve a stuck intent by re-querying
  Stripe) — out of scope for this ticket. An indeterminate payment operation is exactly the case
  that should stop and ask a human, not guess; `listStuckPaymentOperations` makes the guess visible
  instead of making it silently.

## Consequences

- Every Stripe-mutating call in `src/lib/payments/checkout.ts` and `invoicing.ts` now requires an
  `idempotencyKey` (or, for `refundInvoice`, takes one as a parameter) — a caller that doesn't route
  through `startPaymentOperation`/`idempotencyKeyFor` won't compile.
- `refundBookingOnCancellation` (`src/db/refunds.ts`) also now writes an intent before calling
  `refundCheckoutSession`, even though that call already had its own deterministic key — the intent
  is what makes an unresolved auto-refund attempt visible to `listStuckPaymentOperations`, not a
  change to how the refund itself is keyed.
- `voidOrder`/`voidInvoice` are unchanged — void isn't in this ticket's named operation list
  (checkout, invoice, refund) and carries no money, so a duplicate void call is harmless either way.
- The migration adding `bookings.pending_checkout_intent_id` is additive and nullable; no existing
  row is affected.
