# FU-20260813-owed-refunds-have-no-staff-queue — Give a swept departure's un-returnable money somewhere a human will see it

- **Status:** Open
- **Raised:** 2026-08-13 — branch `claude/decision-workflow-options-mn0a2k`, building
  ADR 20260813-shop-cancellation-refunds-itself (the shop-cancelled refund).
- **Kind:** half-done
- **Effort:** M
- **Touches:** `src/app/api/cron/minimum-seats/route.ts`, `src/db/today.ts`, `src/lib/today.ts`,
  `src/db/refunds.ts`

## What I noticed

A shop-cancelled departure now refunds itself, and the cases where it *can't* land differently
depending on which path cancelled the trip.

**The blow-out has a surface.** `getTripBlowout` returns each diver's `paymentStatus`, and the
cascade page renders it. A seat whose refund came back `manual` (cash at the counter, a disconnected
Stripe account) or `failed` still reads `paid` there, on a page a staff member is already looking at
because they just called the blow-out. It is not a queue, but it is visible, and somebody is in the
room.

**The sweep has nothing.** `cancelDeparturesBelowMinimum` runs hourly from a cron with no human
anywhere near it. When a refund on a swept departure cannot be issued, three things happen: the
diver is told "you're owed a full refund, and {shop} will be in touch", the payment row stays `paid`
on a cancelled trip, and the count lands in one log line (`refundsOwed` in
`cron_minimum_seats.sweep_complete`). Nothing renders it. No Today row, no badge, no page. The shop
learns it owes somebody money when that person emails to ask.

The diver-facing half is honest — that was the point of stating the outcome in the mail rather than
implying a refund had happened. The staff-facing half is a promise DiveDay made on the shop's behalf
with nothing behind it.

Concretely: a shop taking cash at the counter for a Saturday two-tank, whose Saturday gets swept at
4 AM for being one diver short, has three people expecting their money back and no screen in DiveDay
that says so.

## Why it isn't already done

Scope, and one genuine design question I did not want to answer on a money branch.

The refund decision was about whether money moves automatically. Building a staff surface for the
residue is a different change — it is a new Today row kind (or a new panel), which means the
`src/lib/today.ts` ranking rules, both locale bundles, and a decision about urgency. Doing it in the
same pass as two new refund arms and a schema change would have meant the thinnest possible tests on
the part that touches Stripe.

The design question: **is "money the shop owes a diver" a Today row, or a panel beside the other
back-office queues?** The repo has a clear precedent pointing the second way — stuck payment
operations sit on the Orders index and owed processor erasures sit in Settings, each with the object
it is about, each rendering nothing when empty, and Today *mirrors* the stale ones as `urgency:
"now"` rows rather than owning them (see the back-office queues row in AGENTS.md). Recommendation:
follow that precedent — a panel on the Orders index beside `listStuckPaymentOperations`, gated the
same way, with Today mirroring it once a row is older than a day. What I would *not* do is invent a
fourth place for owed money to live.

## Proposed change

1. A reader in `src/db/refunds.ts` — `listOwedShopCancellationRefunds(db, shopId)` — for bookings
   that are still `paid`/`deposit_paid` on a trip whose status is `cancelled`. That is the whole
   definition of the residue and it needs no new column: the sweep and the cascade both leave
   exactly this shape behind. Bound it the way the other back-office readers are bounded (a limit,
   newest first) and scope it to the shop.
2. A panel on `src/app/shop/[shopSlug]/orders/page.tsx` beside the stuck-operations one, behind the
   same `canPersonManagePaymentSettings` gate, rendering nothing when empty. Each row names the
   diver, the departure, the amount, and links to the booking where staff issue the refund by hand.
3. A Today mirror in `src/db/today.ts` for rows older than a day, pointing at that panel — the same
   shape the two stale-able queues already use.
4. Copy in both locale bundles; a unit test for the reader (including that a *refunded* seat on a
   cancelled trip does not appear, which is the obvious way to get this wrong); a visual capture if
   the panel is more than one line.

Do **not** add a column tracking "refund owed" — the join above is derivable and a stored flag would
need reconciling with Stripe every time a staff member issued the refund by hand.

## Prompt

```text
Give a dive shop a place to see money it owes divers for departures it cancelled but could not
refund automatically.

Read first:
  - docs/product/follow-ups/FU-20260813-owed-refunds-have-no-staff-queue.md (this file)
  - docs/architecture/decisions/20260813-shop-cancellation-refunds-itself.md — what now refunds
    automatically, and the four ways it can come back `manual`/`failed`
  - src/db/refunds.ts — refundBookingOnShopCancellation and its outcome type
  - src/app/api/cron/minimum-seats/route.ts — where refundsOwed is counted and then only logged
  - src/app/shop/[shopSlug]/orders/page.tsx — the stuck-payment-operations panel this should sit
    beside, and the gate it uses
  - the "back-office queues" row in AGENTS.md — the precedent that each queue sits with the object
    it is about and renders nothing when empty

The constraint that makes this non-obvious: there is no "refund owed" column and there should not
be one. The residue is derivable — a booking still paid/deposit_paid on a trip whose status is
cancelled — and a stored flag would have to be reconciled every time staff refunded by hand.

Done means: a bounded, shop-scoped reader in src/db/refunds.ts; a panel on the Orders index behind
canPersonManagePaymentSettings that renders nothing when empty and links each row to where staff
issue the refund; a Today mirror for rows older than a day; copy in both locale bundles; and unit
tests covering the reader — including that a seat which *was* refunded on a cancelled trip does not
appear.

Run pnpm check, then pnpm test src/db/refunds.test.ts src/db/today.test.ts --reporter=dot. Add a
visual capture if the panel is more than a single line.

Delete docs/product/follow-ups/FU-20260813-owed-refunds-have-no-staff-queue.md as part of the change.
```
