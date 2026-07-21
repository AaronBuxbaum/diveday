# 20260721-deposit-cancellation-policy — Deposit at checkout and a declarative cancellation window

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

[Checkout-at-booking](20260721-checkout-at-booking.md) shipped the mechanism for public payment but
with a deliberately provisional policy: full trip price per diver, no deposit tier, no cancellation
window. Those two gaps are the remaining half of **H-07** and the last thing the
[competitive analysis](../../product/competitive-analysis.md#what-blocks-the-purchase) flags before
this checkout takes production money: every credible competitor offers a deposit-only option and a
stated cancellation policy.

H-07's *policy* (what deposit, what window, whether the platform ever takes a fee) remains a
human-owned decision. This ADR ships the *mechanism* with conservative, opt-in defaults, the same
sequencing every prior payment slice used — the shop gets the knobs; nothing is on until a shop
sets it, and the specific dollar amounts and hours a shop chooses are theirs, not ours.

## Decision

- **Deposit is an optional per-diver amount on the trip.** `trips.deposit_cents` is nullable; null
  (the default) charges the full fare exactly as before. When it is a positive amount strictly below
  the per-diver price, checkout charges *that* now, labels the Stripe line "Deposit — {trip}", and a
  completed session settles the covered bookings to `deposit_paid` (which already clears the
  readiness board's payment gate, [20260718-payment-readiness](20260718-payment-readiness.md)) with
  the balance still owed. A deposit at or above the fare, or non-positive, is treated as no deposit
  and charges full — checkout is never a partial that leaves nothing due, and never a "deposit"
  equal to the whole trip. All of this lives in one framework-free helper, `checkoutCharge`
  (`src/lib/deposits.ts`), so the rule has a single definition and a single test surface.
- **The checkout row records what it charged.** `booking_checkouts.is_deposit` snapshots whether the
  session was a deposit, so completion settles to `deposit_paid` vs `paid` from Stripe's own
  evidence — not from re-deriving the trip's current deposit, which a shop may have edited since.
- **Cancellation policy is declarative, not automated.** `trips.cancellation_window_hours` is a
  nullable count of hours before departure during which a diver may cancel for a refund. It is
  *shown* — to divers at booking and on the confirmation, and to staff as a "refund-eligible until"
  cue on paid seats — and computed by `cancellationDeadline`/`withinCancellationWindow`. Refunds
  stay staff-initiated through the diver's payment context; this slice moves no money automatically.
- **Balance collection is unchanged.** The remaining balance after a deposit is collected the same
  way any booking is settled today: a staff order/invoice or a later full checkout, converging on
  the one `setBookingPayment` gate.

### Provisional policy (H-07 remains open)

Deposits and cancellation windows are **off unless a shop sets them**. There is still no tax line,
no platform fee, and no automated refund. A shop's chosen deposit amount and cancellation window are
that shop's commercial terms; DiveDay ships no default value for either. These defaults — and the
choice to keep refunds manual — require H-07 sign-off before production money, recorded in
[human-decisions.md](../../product/human-decisions.md#provisional-implementation-defaults--verify-before-production).

## Alternatives considered

- **Percentage deposit** (e.g. 25% of price) — scales with price but adds rounding rules and reads
  less concretely at checkout ("$45" vs "25%"). A flat per-diver amount is the simpler first slice;
  a percentage can layer on the same column shape later if shops ask.
- **Automated refund inside the window** — the highest-value version, but it moves real money on a
  finance- and safety-critical path (cancel → Stripe refund → seat freed → notify), needing its own
  failure-path design and `dive-domain-expert` review. Deferred; the declarative window is the
  honest, staff-run bridge that a later ADR can automate.
- **Store the deposit rule per shop, not per trip** — more ergonomic for a shop that always takes
  the same deposit, but price already lives per trip (`trips.price_cents`); putting deposit and
  window beside it keeps one place to reason about a trip's money. A shop-level default can be added
  later as a pre-fill without moving the source of truth.

## Consequences

- The best booking flow in the market can now take a deposit and state a cancellation policy — the
  last buyer objection the competitive analysis raised, with the shop's own account as merchant of
  record throughout and the safety-critical booking transaction untouched.
- Deposit is additive and fail-safe: an unpriced trip, no deposit, or a deposit ≥ price all behave
  exactly as before, and a Stripe outage still degrades to book-now-pay-later.
- `booking_payments` reaches `deposit_paid` by a real path for the first time; readiness already
  honored it, so no gate logic changed.
- H-07's remaining questions (percentage deposits, automated refunds, tax, fees) now gate *pricing
  posture and money-movement automation*, not mechanism. Revisiting means adding a column or a
  refund path, not reworking checkout — the escape hatch stays cheap.
