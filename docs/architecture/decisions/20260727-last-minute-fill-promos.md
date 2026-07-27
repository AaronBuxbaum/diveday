# 20260727-last-minute-fill-promos — Shop-wide last-minute list + Stripe-backed trip discount codes

- **Status:** Accepted
- **Date:** 2026-07-27

## Context

A trip departing soon with open seats is pure lost revenue — every unsold seat costs the shop the
same fuel/crew/boat-day regardless of how many divers show up. Shops want a way to push a
time-boxed discount at divers who are around and likely to say yes, right before a departure.

Two things do not exist yet:

- A durable "divers who want to hear about last-minute deals" signal. The existing **wait list**
  (`trip_waitlist_entries`, [20260719-trip-waitlist](20260719-trip-waitlist.md)) is deliberately the
  opposite case — interest in one *full* trip, first-come, never a general availability signal. Reusing
  it would conflate "I want the seat that's already gone" with "I'm around and might take a deal."
- Any discount/promo-code model. Flagged as a real gap with no data model to hang it on
  ([fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md)) —
  "not just a second line-item adjustment... a real promotion model (codes, limits, redemption
  history) has to exist before the server can even validate a submitted code."

## Decision

**A new, separate "last-minute list."** One row per shop per person
(`last_minute_list_entries`, `findOrCreatePerson`-backed, same identity-match-key rules as the wait
list and public booking), carrying an optional `available_from`/`available_until` date range the
diver gave at sign-up. No range means no bound on that side — "I'm around whenever." A shop-wide,
not per-trip, opt-in: a diver joins once from the public schedule page, not from a specific trip.

**Stripe-native promotion codes for the discount**, not a DiveDay-internal percent-off table. Staff
pick a discount percent on a specific under-capacity trip; DiveDay creates a Stripe `Coupon`
(`percent_off`, `duration: once`) and a `PromotionCode` on the shop's own connected account
(`Stripe-Account` header, same fetch-based pattern as `checkout.ts`/`invoicing.ts` — no SDK), with
`expires_at` pinned to the trip's departure and `max_redemptions` capped at the trip's open-seat
count at send time. One `trip_last_minute_promos` row records the code, its Stripe object ids, the
discount percent, and who sent it — durable evidence written *before* the Stripe calls (same
before-the-external-call pattern as `startBookingCheckout`), so a crash mid-send leaves a
`pending`/`failed` row an operator can see rather than nothing at all.

The code is **not** self-serve on Stripe's hosted page (`allow_promotion_codes`) — that would let a
diver apply any code they've ever received to any trip's checkout, since Stripe has no notion of
"this code is for this trip." Instead the diver enters the code on DiveDay's own booking form; the
server looks it up by `(shop, trip, code)`, confirms it is `sent` and unexpired, and only then hands
it to `checkout.createCheckoutSession` as an explicit `discounts[0][promotion_code]`. Stripe still
independently enforces `max_redemptions` and `expires_at` at checkout completion — belt and
suspenders, not a substitute for the trip-scope check.

**Blast is staff-triggered, with a Today nudge.** Staff open a trip, see how many last-minute-list
divers' date ranges overlap the departure, pick a discount, and send — this reuses the trip page's
existing one-tap-send shape (`WaitlistSection`/`WaitlistInvite`). Additionally, any scheduled trip
departing within 3 days that is under capacity and has never had a promo sent gets a Today card
(`last_minute_fill`, `soon` urgency) pointing at the trip. The card is one-shot per trip — once any
promo has been sent, Today stops nudging even if the trip is still under capacity, so a shop that's
already tried isn't nagged; staff can still resend anytime from the trip page.

## Alternatives considered

- **Reuse `trip_waitlist_entries`** — rejected; it's per-trip and gated to full trips only, and
  overloading it would make its existing "first-come order for a full charter" meaning ambiguous.
- **DiveDay-internal discount math** (store a percent, apply it to `unitAmountCents` ourselves) —
  simpler (no new Stripe API surface) but re-implements what Stripe's coupon/promotion-code objects
  already do correctly (expiry, redemption caps), and starts the "real promotion model" the gap
  analysis called out from a narrower, harder-to-extend place.
- **`allow_promotion_codes` on Checkout** — rejected: it detaches the code from the trip it was
  issued for, so a diver could apply trip A's 50%-off to an unrelated trip B booked before it
  expires. Explicit server-side trip-scoped lookup avoids that at the cost of one more form field.
- **Auto-trigger the blast** (send automatically N hours before departure if under capacity) —
  deferred. Picking the discount percent and deciding *whether* to discount at all is a commercial
  call a shop should make deliberately, not something DiveDay does unattended with their Stripe
  account's money on the line.

## Consequences

Shops get a real lever for the "every empty seat is money lost" problem without DiveDay inventing
its own discount-math surface — Stripe already solved coupon/promo-code correctness, and the shop's
own dashboard shows the same objects DiveDay created. The trip-scoping check is DiveDay's one added
responsibility, and it fails closed (unmatched/expired/wrong-trip code silently does not discount,
never errors the booking).

What this makes hard: a diver can still apply a code to a *different* trip on the same shop, as long
as they type the exact code and that trip's own booking form happens to validate it — no, it can't:
the lookup is `(shop, trip, code)`, so a code only ever validates against the trip it was issued for.
The accepted gap is narrower — nothing stops two staff members sending overlapping/competing
discounts on the same trip, since sends are unlimited and not versioned against each other. Revisit
if that becomes a real support cost; the fix is a `latest active promo wins` rule.

The promo code is only threaded through the initial `bookSpot` checkout-start call, not the
"Finish paying" resume (`payForBooking`) — resuming reuses the same still-open Stripe session
(`startBookingCheckout`'s existing dedup), so the discount survives a resume as long as that
session hasn't expired. If it has (Stripe's own ~24h default), a resume mints a fresh, undiscounted
session with no explicit warning that the deal was lost. Narrow (the whole feature's premise is a
trip departing in a day or two, so the window for this to bite is short) but accepted rather than
adding a durable per-booking promo column to close it in this slice — revisit if it becomes a real
complaint, by carrying the applied promo id on the booking itself.

This is deliberately not a general storefront-wide promo/coupon system (stacking rules, cart-level
discounts, non-trip line items) — that broader model, if it's ever built, should treat this as one
narrow producer of Stripe promotion codes, not the thing it replaces.
