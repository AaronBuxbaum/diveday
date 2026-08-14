# FU-20260814-seed-an-open-invoice-on-a-departure — Give the demo one unpaid seat, so the trip pulse's money fact renders

- **Status:** Open
- **Raised:** 2026-08-14 — wiring `?tripId=` through the Orders index (FU-20260814-orders-index-trip-filter)
- **Kind:** half-done
- **Effort:** S
- **Touches:** `src/db/seed-orders.ts`, `e2e/trips.spec.ts`, `e2e/visual.spec.ts`

## What I noticed

The trip Overview's pulse states "N orders are awaiting payment ›" when a departure has open
orders, counted by `countOpenTripOrders`. **No seeded departure ever has one**, so that fact does
not render anywhere in the demo shop — not on screen for someone evaluating DiveDay, not in a
screenshot, not in a test that could click it.

The seed has both halves and never crosses them. `src/db/seed-orders.ts` writes five `open` orders
and every one of them sets `bookingId: null` on purpose (it says why: a booking-linked paid or
refunded order cascades onto that booking's payment gate through `applyOrderUpdate`, and a seeded
one would contradict the `booking_payments` row the bookings scenario wrote). `src/db/seed-history.ts`
writes booking-linked orders, and all of them are `paid` on departures that already sailed.

The consequence for testing: `e2e/trips.spec.ts`'s new "the money fact's link opens an Orders index
narrowed to that one departure" test has to `goto` the URL the pulse builds instead of clicking the
fact, because the fact is not on the page. The link's *shape* is asserted; the fact that produces it
is not exercised end to end, and it has no visual baseline.

## Why it isn't already done

It is a seed change, and a seed change to `booking_payments`-adjacent rows is exactly the shape
`seed-orders.ts`'s own comment warns about. Getting it right means picking a booking whose payment
state can honestly read as "invoiced, not yet paid" — and that is a judgement about the demo's
story (which diver on which upcoming boat still owes money), not a mechanical edit. It was also
outside the scope I was given, which was the Orders index.

## Proposed change

In a new `src/db/seed-<scenario>.ts` (or `seed-orders.ts`, if the booking-payment interaction is
checked), write **one** `open` order against a booking on an upcoming departure — the reef trip is
the one every test and screenshot already knows. `open` is safe where `paid`/`refunded` are not:
`applyOrderUpdate` cascades on settlement, and an open invoice settles nothing. Then:

- click the fact in `e2e/trips.spec.ts` rather than reconstructing its URL, and drop the comment
  that explains why it could not;
- add the trip Overview to `e2e/visual.spec.ts`'s captures if the pulse's third fact is not already
  in one, so the money row has a baseline.

Not proposing several: the pulse states a count, and one row proves the fact, the link, and the
filtered index it opens. A pile of unpaid seats would also change what the Today queue and the
Orders index look like in every screenshot that includes them.

## Prompt

```text
Read src/db/seed-orders.ts (especially the comment about why every seeded order sets bookingId to
null), src/db/seed-history.ts's order block, and countOpenTripOrders in src/db/orders.ts. The trip
Overview's pulse renders "N orders are awaiting payment ›" only when a departure has open orders,
and no seeded departure has one — so that fact never appears in the demo shop or in any screenshot,
and e2e/trips.spec.ts has to navigate to the link's URL instead of clicking the fact. Seed exactly
one open, booking-linked order on an upcoming departure (the seeded reef trip, "Two-Tank Reef —
Molasses & French"), in its own seed-<scenario>.ts plus one line in src/db/seed.ts's orchestrator.
Keep it `open`: applyOrderUpdate cascades a paid or refunded booking-linked order onto that
booking's payment gate, which is what the existing comment is guarding, and an open invoice settles
nothing. Then make e2e/trips.spec.ts's "the money fact's link opens an Orders index narrowed to that
one departure" test click the fact on the Overview instead of building its URL, and check whether
the trip Overview has a capture in e2e/visual.spec.ts — if the pulse's money row has no baseline,
add one. Done means: the pulse fact is visible on the seeded reef trip, the e2e test clicks it, and
pnpm check plus pnpm e2e:run e2e/trips.spec.ts --reporter=line are green. Delete
docs/product/follow-ups/FU-20260814-seed-an-open-invoice-on-a-departure.md as part of the change.
```
