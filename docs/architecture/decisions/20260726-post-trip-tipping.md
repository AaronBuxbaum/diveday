# 20260726-post-trip-tipping — Post-trip crew tipping

- **Status:** Accepted; storage amended 2026-11-03 (issue #2718)
- **Date:** 2026-07-26

## Context

[fareharbor-feature-gaps-20260726.md](../../product/archive/fareharbor-feature-gaps-20260726.md)
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
- **A tip is a `booking_checkouts` row with `purpose = 'tip'` (amended 2026-11-03, issue #2718).**
  This ADR first chose a separate `tips` table with its own lifecycle and a webhook fallback that
  tried it when a session id missed `booking_checkouts`. Three Stripe lifecycles (checkouts, tips,
  payment operations) had grown three copies of the same pending/paid/expired code, so tips folded
  into the checkout table. The cascade risk that drove the original choice is now held by the
  schema and a guard instead of by table separation: `markCheckoutPaidBySessionId` settles a seat
  only for `purpose = 'fare'` and hands a tip to `settleTipCheckout`, which never touches the
  booking-payment gate or sends a party receipt; the check constraint `booking_checkouts_tip_shape`
  forbids a tip any deposit, promo, discount, tax or pass-through fee; and
  `scripts/check-checkout-purpose.mjs` fails any query on the checkout tables that names neither
  `fareCheckout()` nor `tipCheckout()` (`src/db/checkout-purpose.ts`) nor says why it reads both.
  One session-id space, one webhook path, no fallback.
- **A bounded free-form field: three presets plus an "Other" amount, both clamped to $1–$500
  (`MIN_TIP_CENTS`/`MAX_TIP_CENTS`).** The recap page offers three preset amounts (`$5`/`$10`/`$20`)
  and a custom-amount input for anyone who wants a different number — generous enough for a real
  gratitude tip, bounded against a mistyped amount (a stray extra digit) or an abusive one (someone
  probing the checkout endpoint). The client keeps the two mutually exclusive (`TipAmountPicker`,
  `src/app/(token)/recap/[token]/TipAmountPicker.tsx`), but the bound itself is enforced server-side in
  `startTipCheckout`, not just the form's `min`/`max` — the recap page is a public token-auth surface,
  so the real bound lives on the server regardless of which of the two fields the diver used.
- **Shop identity is derived from the booking, never accepted from the caller.** `startTipCheckout`
  takes only a `bookingId` and looks up `shopId` from that booking's own row — the same "never trust a
  client-supplied tenant id" rule the booking-capability system already follows, since the recap
  flow's only credential is a signed token that resolves to a `bookingId` (`verifyRecapToken`).
- **Rate-limited per booking, like the recap photo upload.** `tipStart` (`src/lib/rate-limit.ts`) caps
  attempts per booking — a public, token-auth endpoint that creates real Stripe Checkout sessions needs
  its own abuse control, independent of the shop's own rate limits.
- **A `no_show` booking gets no recap at all, tip included (Codex finding — supersedes this ADR's
  original, narrower decision).** A no-show never dived, so "how was your dive?", the tip ask, and the
  review ask are all equally inapplicable — not just `canTip`/`reviewUrl` in isolation. `getRecapPageData`
  (`src/features/recap/store.ts`) now returns `null` for a `no_show` booking the same way it already does for
  `cancelled`, and `sendDueRecaps`'s eligibility query excludes `no_show` alongside `cancelled` at the
  source, so one never even gets the recap link to begin with. `startTipCheckout` also refuses a
  `no_show` booking directly, the same defense-in-depth the `cancelled` check already gets, so a
  hand-crafted or replayed request against the endpoint can't tip one either.

## Alternatives considered

- **A percentage split to DiveDay** — some marketplaces take a cut of tips; rejected because a tip is
  explicitly "for the crew," and skimming it would misrepresent what the diver is paying for. The
  merchant-of-record model already means DiveDay isn't in the money path for bookings either; tipping
  follows the same principle.
- **Reusing `booking_checkouts`** — first rejected for the cascade risk; adopted 2026-11-03 once a
  purpose column, a check constraint and a repo guard could hold that line (see Decision).
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
- **Known gap (Codex finding, accepted for now):** `startTipCheckout`'s row-locked transaction wraps
  the payment-operation intent's start/resolve *and* the Stripe call in one commit, unlike
  `startBookingCheckout`'s durable-intent-before-Stripe-call ordering — a crash between Stripe
  succeeding and the transaction committing leaves no local trail of that session. Fixing this
  properly needs the same lock-free claim mechanism `startBookingCheckout` uses
  (`claimBookingsForCheckout`), which this ADR already rejected reusing directly for tips (a shared
  claim column would cross-block two independent money flows); it would need its own dedicated claim
  column — a schema change against a money-handling path, not a quick patch. Bounded blast radius:
  DiveDay never holds the money, so an orphaned session means the shop's own Stripe dashboard is the
  reconciliation source of truth, never a lost or double charge. Revisit if this surface's volume ever
  makes that manual reconciliation actually painful.

## Addendum (issue #3835): a tip's refunds and disputes do not depend on delivery order

Stripe promises no webhook order, so a tip's `refunded_cents` (what came back by a refund, plus what a
lost dispute took, capped at the tip) is written to give one answer in any order (`src/db/tip-reversals.ts`).

- A refund event recomputes the figure from Stripe's running total plus the tip's lost disputes, so a
  dispute recorded before a delayed refund event leaves both counted.
- A refund event stamped no later than the tip's newest refund failure is ignored: its running total
  was taken before the failure. Every failure is written down, including one delivered before the
  refund it undoes.
- **Not done, and unconfirmed:** whether Stripe lowers `amount_refunded` on a charge when a refund
  fails. Nothing here relies on it either way (the failure reverses the stored figure by the failed
  amount, and older totals are ignored), but a Stripe test-mode run should settle it.
- Fares keep the same guard (`refundedTotalNetOfLaterFailures`, `src/db/refunds.ts`): an order's or
  a checkout's refund event counts Stripe's running total less each refund failure recorded after
  the event's own instant (an order's read under its lock), so a refund event delivered after its
  failure puts nothing back. A fare failure delivered before its refund is written down too, with the
  refund's own amount, and never reads as owed.
