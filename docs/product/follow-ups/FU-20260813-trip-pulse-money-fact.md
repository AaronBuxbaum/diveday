# FU-20260813-trip-pulse-money-fact — Add an awaiting-payment fact to the trip pulse

- **Status:** Open
- **Raised:** 2026-08-13 — the trip pulse (branch claude/app-design-overhaul-g0ksof)
- **Kind:** improvement
- **Effort:** S
- **Touches:** `src/app/shop/[shopSlug]/trips/[id]/page.tsx`, `src/app/shop/[shopSlug]/trips/[id]/_components/TripPulse.tsx`, `src/db/orders.ts`

## What I noticed

The trip Overview now opens with a pulse — seats in words and numbers, then only-when-nonzero
linked facts ("1 diver can't board yet ›" → the blocked-filtered roster, "5 divers are missing
rental sizes ›" → the Prep tab). The third question a staffer asks of an upcoming boat — "is
anyone still owing money for it?" — is not on the strip. An order awaiting payment for this trip
(the "Open — awaiting payment" state the Orders index shows) is exactly the kind of fact the
pulse exists to bubble up, and today it is only discoverable by leaving the trip for the Orders
index and filtering by hand.

## Why it isn't already done

Deliberately scoped out of the pulse's first cut. The two shipped facts reuse readers their
destination surfaces already trust (`listTripReadiness`, `listTripPrepDivers` +
`rentalFitCompleteness`), so their counts cannot disagree with the pages they link to. There is
no equivalent "open orders for one trip" reader yet, and the right link target needs a decision:
the Orders index has no `?trip=` filter, so the fact would either link to an unfiltered list
(breaking the pulse's contract that a fact lands on its fix) or the index needs that filter first.

## Proposed change

Add a bounded reader (count of open/awaiting-payment orders for one trip, probably in
`src/db/orders.ts` beside its existing per-trip reads), give the Orders index a server-rendered
trip filter param the same way the Guests roster takes `?rf=`, and append the fact to
`pulseFacts` with neutral (not danger) tone — money outstanding is work, not a boarding hazard.
Not proposing a per-diver payment breakdown on the Overview; the Guests roster already carries
per-booking payment state.

## Prompt

```text
Read docs/design/principles.md (#9, #10), src/app/shop/[shopSlug]/trips/[id]/_components/TripPulse.tsx,
and the pulse assembly in src/app/shop/[shopSlug]/trips/[id]/page.tsx. Add a third
only-when-nonzero fact to the trip pulse: how many of this trip's orders are still awaiting
payment. Constraints that make this non-obvious: the pulse's contract is that every fact links to
the surface that fixes it and its count comes from a reader that surface already trusts — so
first give the Orders index (src/app/shop/[shopSlug]/orders/page.tsx) a server-rendered trip
filter, then count through the same query shape. Words go in src/i18n/locales/en-US/staff/trips.json
under trips.pulse and in es-ES in the same change. Done means: the fact renders only when the
count is nonzero, links to the filtered Orders index, e2e/trips.spec.ts's "trip pulse" test is
extended to cover it, and pnpm check plus pnpm e2e:run e2e/trips.spec.ts --reporter=line are
green. Delete docs/product/follow-ups/FU-20260813-trip-pulse-money-fact.md as part of the change.
```
