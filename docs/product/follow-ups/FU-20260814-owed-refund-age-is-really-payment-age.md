# FU-20260814-owed-refund-age-is-really-payment-age — Give a cancelled departure a cancellation timestamp, so "owed for a day" means what it says

- **Status:** Open
- **Raised:** 2026-08-14 — branch `claude/decision-workflow-options-2n06b1`, building the
  owed-refund queue (ADR 20260813-shop-cancellation-refunds-itself's closed consequence).
- **Kind:** improvement
- **Effort:** M
- **Touches:** `src/db/schema.ts`, `src/db/trips-record.ts`, `src/db/trips-minimum.ts`,
  `src/db/blowouts.ts`, `src/db/refunds.ts`, `src/db/today.ts`

## What I noticed

`listOwedShopCancellationRefunds` takes an `olderThan` bound so Today can wait a day before
mirroring an owed refund into the queue. The column it compares against is
`booking_payments.updated_at`, and for one of these rows that timestamp is **when the diver paid**,
not when the money became owed.

The reason is that nothing records when a departure was cancelled. `trips` has a `status` and a
`created_at` and no `updated_at`; a refund that could not be issued deliberately leaves the payment
row untouched, so there is no "we tried and failed at T" stamp either. `booking_payments.updated_at`
was the only durable timestamp within reach.

What that produces in practice is a rule that reads as "money the shop has held for more than a day
that now belongs to somebody else", which is true and defensible — but it is not the rule the ADR
describes, and the two come apart in both directions:

- A shop cancels a Saturday charter that everyone paid for weeks ago. Every seat is instantly past
  the one-day bound, so Today shows the whole list the moment the sweep runs. In effect the delay
  does not exist. (This is the common case, and it is arguably the *right* outcome — a diver has
  already been emailed that the shop will be in touch — but it is not what the code claims.)
- A walk-in pays cash on Friday morning for a Friday-evening dive that gets blown out that
  afternoon. That seat is under the bound and stays off Today until Saturday morning, even though it
  is the freshest, most-likely-to-be-asked-about money on the list.

Neither is a bug anybody will report. Both are the code meaning something slightly different from
what its constant is named for.

## Why it isn't already done

It needs a schema change, and the follow-up that asked for this queue was explicit that a stored
`refund_owed` flag must not be added — the residue has to stay derivable so nothing needs reconciling
with Stripe when a staffer hands back cash by hand. I agree with that and did not want to blur it by
adding *some* column on a branch whose decision was about where the queue lives.

The distinction worth drawing, and the reason I think this is worth doing: **`trips.cancelled_at` is
not a refund flag.** It is a fact about the departure — when the shop called it off — that the schema
currently throws away entirely. Nothing about it needs reconciling with anything: it is written once,
by whoever cancels. It happens to make this queue honest, but it would also answer "when did we
cancel this?" for the departure log, the blow-out story, and anything else that later wants to know.

## Proposed change

1. `trips` gains a nullable `cancelled_at` timestamp. Nullable rather than backfilled: the trips
   already cancelled genuinely have no recorded time, and inventing one would be worse than admitting
   it.
2. Set it wherever a trip becomes `cancelled`. `setTripStatus` (`src/db/trips-record.ts`) is the seam
   the blow-out cascade uses and is the obvious place — stamp on the transition to `cancelled` and
   clear on the transition back to `scheduled`, so an un-cancelled trip does not keep a stale date.
   Check `src/db/trips-minimum.ts`, which currently writes the status directly rather than through
   that seam; route it through `setTripStatus` in the same change rather than duplicating the stamp.
   (`src/db/trips-series.ts` also writes `cancelled` — read it before assuming it means the same
   thing; a series operation cancelling an occurrence may or may not want the same stamp.)
3. `listOwedShopCancellationRefunds`'s `olderThan` compares against `trips.cancelled_at`, with a NULL
   treated as **stale** — a trip cancelled before this column existed has been owed for a while by
   definition, and failing toward showing the money is the right direction to fail.
4. Rename `OWED_REFUND_STALE_AFTER_MS`'s doc comment to say what it now measures, and update the test
   in `src/db/refunds.test.ts` ("holds back money that only just changed hands") — it currently
   backdates `booking_payments.updated_at` and would need to backdate the trip instead.

Do **not** add a `refund_owed` column or any per-booking "we tried and failed" flag. The residue
stays derivable; this adds one fact about the trip, not a state about the money.

## Prompt

```text
Give DiveDay a record of when a departure was cancelled, and make the owed-refund queue's staleness
bound mean what it says.

Read first:
  - docs/product/follow-ups/FU-20260814-owed-refund-age-is-really-payment-age.md (this file)
  - src/db/refunds.ts — listOwedShopCancellationRefunds and OWED_REFUND_STALE_AFTER_MS, including
    the doc comment explaining why it currently reads booking_payments.updated_at
  - src/db/trips-record.ts (setTripStatus), src/db/trips-minimum.ts (writes the status directly),
    src/db/blowouts.ts (cancels through setTripStatus inside a transaction)
  - src/db/today.ts — the owed_refund mirror that passes the bound
  - the schema-change skill

The constraint that makes this non-obvious: do NOT add a "refund owed" column or any per-booking
flag. The owed-refund list is deliberately derivable — a seat still holding a capture on a cancelled
trip — so that a staffer refunding cash by hand never leaves a stored flag to reconcile. What is
missing is one fact about the *trip*: when it was cancelled. That is written once and needs
reconciling with nothing.

Done means: trips.cancelled_at exists (nullable, no backfill), is stamped on every transition into
`cancelled` and cleared on the way back to `scheduled`, listOwedShopCancellationRefunds bounds on it
with NULL treated as stale, and the tests in src/db/refunds.test.ts and src/db/today.test.ts are
updated to backdate the trip rather than the payment row.

Check src/db/trips-series.ts before assuming every write of `cancelled` wants the same stamp — a
series occurrence being taken off the board may not be the same act as a shop calling off a
departure.

Run pnpm check, then pnpm test src/db/refunds.test.ts src/db/today.test.ts src/db/blowouts.test.ts
--reporter=dot.

Delete docs/product/follow-ups/FU-20260814-owed-refund-age-is-really-payment-age.md as part of the
change.
```
