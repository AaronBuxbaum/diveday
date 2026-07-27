# 20260726-post-trip-tipping — Post-trip crew tipping

- **Status:** Accepted
- **Date:** 2026-07-26

## Context

[fareharbor-feature-gaps-20260726.md](../../product/assessments/fareharbor-feature-gaps-20260726.md)
flagged crew tipping alongside the review-request gap: a diver who just had a great day has nowhere to
say thanks in dollars, and a shop has no built-in way to offer that without falling back to a jar at
the counter or a separate app. The recap page is the natural surface — it's already the "that was
great, what's next" moment (`docs ADR 20260723-post-trip-recap`) — and the shop's own Stripe Connect
account (`docs ADR 20260721-checkout-at-booking`) already gives DiveDay a payment rail into the same
merchant-of-record model bookings use.

## Decision

- **A tip is a full 100%-to-shop Stripe Checkout, same merchant-of-record model as a booking payment,
  no platform fee.** `startTipCheckout` (`src/db/tips.ts`) creates a hosted Checkout session on the
  shop's own connected account via the existing `CheckoutProvider` seam — the same interface
  `startBookingCheckout` uses. DiveDay never touches the money; a tip is exactly as much "the shop's"
  as a card payment at the counter would be.
- **A dedicated `tips` table, not a reuse of `booking_checkouts`.** A tip is always exactly one
  booking (never a party purchase), never touches the booking-payment gate `booking_checkouts`
  cascades into via `markCheckoutPaidBySessionId`, and its own lifecycle (`pending` → `paid` /
  `expired`) is simpler. Sharing a table would mean threading a "this row is a tip, don't cascade"
  branch through every booking-checkout code path; a same-shape, separate table keeps that branch out
  of the booking-payment logic entirely.
- **Shared Stripe session-id space, disambiguated by trying the booking path first.** A Stripe session
  id belongs to at most one of `booking_checkouts` or `tips`. The webhook handler
  (`src/app/api/webhooks/stripe/route.ts`) tries `markCheckoutPaidBySessionId` first and only calls
  `markTipPaidBySessionId` when that finds no matching row — cheaper than tagging every webhook event
  with which table to check, and correct because the two tables' session ids are disjoint by
  construction (each is only ever written by its own `startXCheckout`).
- **A bounded free-form field: three presets plus an "Other" amount, both clamped to $1–$500
  (`MIN_TIP_CENTS`/`MAX_TIP_CENTS`).** The recap page offers three preset amounts (`$5`/`$10`/`$20`)
  and a custom-amount input for anyone who wants a different number — generous enough for a real
  gratitude tip, bounded against a mistyped amount (a stray extra digit) or an abusive one (someone
  probing the checkout endpoint). The client keeps the two mutually exclusive (`TipAmountPicker`,
  `src/app/recap/[token]/TipAmountPicker.tsx`), but the bound itself is enforced server-side in
  `startTipCheckout`, not just the form's `min`/`max` — the recap page is a public token-auth surface,
  so the real bound lives on the server regardless of which of the two fields the diver used.
- **Shop identity is derived from the booking, never accepted from the caller.** `startTipCheckout`
  takes only a `bookingId` and looks up `shopId` from that booking's own row — the same "never trust a
  client-supplied tenant id" rule the booking-capability system already follows, since the recap
  flow's only credential is a signed token that resolves to a `bookingId` (`verifyRecapToken`).
- **Rate-limited per booking, like the recap photo upload.** `tipStart` (`src/lib/rate-limit.ts`) caps
  attempts per booking — a public, token-auth endpoint that creates real Stripe Checkout sessions needs
  its own abuse control, independent of the shop's own rate limits.

## Alternatives considered

- **A percentage split to DiveDay** — some marketplaces take a cut of tips; rejected because a tip is
  explicitly "for the crew," and skimming it would misrepresent what the diver is paying for. The
  merchant-of-record model already means DiveDay isn't in the money path for bookings either; tipping
  follows the same principle.
- **Reusing `booking_checkouts`** — rejected per above; a tip's simpler lifecycle and the risk of an
  accidental cascade into booking-payment logic outweighed the marginal reuse.
- **A running per-crew-member ledger (split a tip across named crew)** — real value for a bigger shop,
  but a materially larger feature (crew accounts, split logic, payout routing) than this slice's scope.
  The tip goes to the shop's account; how it's shared with the crew is the shop's own process, same as
  a cash tip today.

## Consequences

- A diver can tip the crew in a few taps from the same page they're already looking at post-trip, with
  100% landing in the shop's own account.
- The feature is inert until a shop both connects Stripe and has `chargesEnabled` — nothing changes
  for a shop that hasn't connected one, same gating `canAcceptPayments` already applies to booking
  payments.
- No crew-level attribution or payout splitting exists; a shop that wants to divide tips among crew
  members does so outside DiveDay, same as they would with a cash tip jar today.
