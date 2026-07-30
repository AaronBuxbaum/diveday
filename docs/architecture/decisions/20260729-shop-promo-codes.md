# 20260729-shop-promo-codes — Shop-wide promo codes

- **Status:** Accepted
- **Date:** 2026-07-29

## Context

[20260727-last-minute-fill-promos](20260727-last-minute-fill-promos.md) built the first real discount
mechanism: staff pick a percent on one under-capacity departure, DiveDay mints a Stripe
`Coupon`+`PromotionCode` on the shop's connected account, and the diver types the code on that trip's
booking form. That ADR closed by saying what it was not: "deliberately not a general storefront-wide
promo/coupon system… that broader model, if it's ever built, should treat this as one narrow producer
of Stripe promotion codes, not the thing it replaces."

This is that broader model. The FareHarbor gap audit
([fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md))
ranks it second by leverage-per-effort and notes the real work is design, not plumbing: "promo/discount
codes need real design work (discount-stacking rules)."

## Decision

**A code belongs to the shop, not to a departure.** `shop_promo_codes` holds the normalized code, a
percent, a scope (`all` / `trips` / `courses`), an optional start and expiry, an optional redemption
cap, and the Stripe object ids. Trip-scoped last-minute blasts keep their own table and their own
`(shop, trip, code)` lookup — nothing about them changes.

**Stripe stays the discount engine.** As with last-minute promos, DiveDay never does its own discount
arithmetic: it creates the coupon and promotion code on the shop's own account and hands the resolved
`promo_…` id to Checkout as an explicit `discounts[0][promotion_code]`. `allow_promotion_codes` is
still never set, so a code can only ever apply where the server decided it applies. Stripe
independently enforces expiry and the redemption cap at payment time; the local row records what the
shop *configured*, and the scope/window check that Stripe has no concept of.

**One code per checkout — no stacking.** This is the "real design work" the gap audit flagged, and the
answer is the boring one. Stripe Checkout accepts a single promotion code, so stacking would mean
DiveDay computing combined discounts itself and handing Stripe a synthesized number — re-introducing
exactly the discount arithmetic this design avoids, and making "why was I charged this?" a support
question nobody can answer from the Stripe dashboard alone.

**Trip-scoped wins over shop-wide.** Both kinds are typed into the same box, because a diver has no
idea which kind they were handed. `bookSpot` resolves the trip-scoped code first (the more specific
match) and falls back to the shop-wide lookup. A code that matches neither silently does not
discount — never an error.

**Every failure looks identical to the diver.** `getRedeemableShopPromo` returns null for an unknown
code, a disabled one, one outside its window, and one out of scope alike. Distinguishing them would
turn the public booking form into an oracle for enumerating a shop's live codes. There is no separate
"check this code" endpoint for the same reason: resolution happens inside the booking submit, which
has already committed a seat and is rate-limited, so it is not a free guessing loop.

**Redemptions are recorded, not counted from.** `shop_promo_redemptions` is written inside
`markCheckoutPaidBySessionId`'s transaction and is unique on `checkout_id`, so a retried Stripe
webhook cannot inflate a code's usage. It is an audit trail for reporting and for a later refund
conversation — Stripe remains the authority on whether a redemption was *allowed*.

**Owner/manager only.** Codes discount real money on the shop's own account, so the staff page sits
behind `canPersonManagePaymentSettings` (H-14, [20260724-role-authorization](20260724-role-authorization.md)),
re-checked in both the page and every action rather than merely hidden from the nav.

## Alternatives considered

- **Extend `trip_last_minute_promos` with a nullable `trip_id`** — rejected. That table's meaning is
  "one blast on one departure, capped at its open seats and expiring at its departure"; making the
  trip optional would leave every column conditionally meaningful and every query needing to know
  which flavor it was reading.
- **DiveDay-computed discounts** (store a percent, subtract it from `unitAmountCents` before creating
  the session) — rejected for the same reason the last-minute ADR rejected it: Stripe's coupon
  objects already implement expiry and redemption caps correctly, and the shop's own dashboard then
  shows the same objects DiveDay created.
- **Fixed-amount discounts alongside percentages** — deferred. Percent-only avoids the currency and
  partial-refund edge cases entirely while `orders.currency` is still hardcoded USD
  (`fareharbor-feature-gaps-20260726.md` treats multi-currency as correctly unbuilt). Adding
  `amount_off` later is an additive column plus a branch in the Stripe call.
- **Auto-applied codes** (a discount that needs no typing) — rejected here. It is a different feature
  with different questions (who qualifies, how it is disclosed before payment) and belongs with the
  credit-ledger work in the brainstorm, not with typed codes.

## Consequences

Shops get the standing-discount lever every competitor has, using the same Stripe-native mechanism
already proven by last-minute blasts, and with a redemption history the gap analysis specifically
called for.

What this makes harder: a diver who was handed a shop-wide code and a trip code can only use one, and
the form does not tell them which one applied — Stripe's hosted page shows the real price before they
pay, which is the honest place for that answer, but it is not surfaced on DiveDay's own form. Adding
an applied/not-applied line means resolving the code before the booking transaction, which would make
it exactly the enumeration oracle this design avoids; revisit only with a rate limiter designed for
it.

A code's local `status` and Stripe's view can also drift if someone edits or deletes the promotion
code in the Stripe dashboard directly — DiveDay never re-reads it. The failure is safe (Stripe
refuses the discount at payment, the booking still completes at full price) but silent. A
reconciliation pass belongs with the same background job that already reconciles stuck checkouts, if
it becomes a real support cost.
