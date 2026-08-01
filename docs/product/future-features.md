# Future features

Revenue-layer features DiveDay has deliberately **not** built, kept as a shortlist. Each is a real
dive-shop use case with a verified gap behind it; each is here because it is closer to a new subsystem
than a slice on top of what exists, not because it was judged unimportant.

- [roadmap.md](roadmap.md) is the committed sequence. Nothing in this file is scheduled. An item
  leaves here by earning a roadmap slot and the ADR it needs — not by being built straight from this
  list.
- Every entry says what already exists in the code, what is actually missing, and why it isn't
  scheduled. Verified against the running code 2026-07-30; re-verify before planning from it.
- Both came out of the FareHarbor feature-gap audit
  ([archive/fareharbor-feature-gaps-20260726.md](archive/fareharbor-feature-gaps-20260726.md)), whose
  every other row has shipped — including diver-selectable checkout upsells, this shortlist's third
  entry, once the ADR here unblocked it (see
  [shipped.md](shipped.md#diver-selectable-checkout-upsells--rental-gear-delivered-2026-08-01)). Read
  the audit for the FareHarbor sourcing and the comparison; read this file for the state of what
  remains.

## 1. Gift cards

A shop sells stored value and a diver redeems it against any trip or course.

- **Exists:** nothing — zero references in `src`. The nearest neighbours are Stripe Connect,
  orders/refunds, and the shop-configured discount surface that shipped with promo codes.
- **Missing:** a stored-value ledger — issue, balance, partial redemption, expiry, and how a
  redemption interacts with a refund. A promo code is a discount Stripe computes at payment time; a
  gift card is customer money DiveDay would be holding, so it is a liability to track, not a checkout
  tweak.
- **Why it isn't scheduled:** the ledger is a new subsystem, and unclaimed-balance rules are
  jurisdictional — a finance/legal question before an engineering one (see
  [stakeholders/finance-and-tax.md](stakeholders/finance-and-tax.md)). It is a seasonal revenue lever;
  revisit ahead of a gifting season with real shops on the platform. **ADR required.**

## 2. Private / buyout charters

A group buys out a whole departure: proposal, contract, deposit, and the boat off public sale.

- **Exists:** party booking ships — the public form books a party of up to six atomically
  (`createBookingParty`) on one shared checkout (`startBookingCheckout`), and deposits ship. So
  "group booking" is not the gap. "Charter" elsewhere in the code is only a synonym for a scheduled
  trip (`src/db/seed.ts`).
- **Missing:** the buyout workflow — quote/proposal → contract → deposit → the departure withdrawn
  from public sale — and the resource it blocks. There is still no boat entity; a trip *is* the
  boat-day.
- **Why it isn't scheduled:** it depends on the boat/resource modeling that
  [roadmap.md](roadmap.md#5-multi-boat--multi-shop-configuration) §5 already holds open, and should be
  designed together with it rather than as a separate effort. **ADR required.**

## Not until demand pulls

- **Multi-currency.** `src/db/orders.ts:111` hardcodes `const currency = "usd"` and the schema
  columns default to `"usd"` throughout. Correct for a US-first launch, and reaffirmed by
  [20260729-shop-promo-codes](../architecture/decisions/20260729-shop-promo-codes.md). The work would
  be a per-shop currency setting threaded through orders and checkout plus locale-correct display —
  the arithmetic stays in Stripe. Don't build ahead of a real non-US prospect.

## Smaller follow-ons live with their ADRs

These are per-feature rough edges on shipped work, not future subsystems. They are recorded in the
*Consequences* of the ADR that shipped each feature, which stays the place to look:

- Fixed-amount (rather than percent) discounts, auto-applied codes, and Stripe-side drift on a code's
  status — [20260729-shop-promo-codes](../architecture/decisions/20260729-shop-promo-codes.md).
- Self-service reschedule of a *paid* booking, which still requires staff —
  [20260727-diver-self-service-cancel](../architecture/decisions/20260727-diver-self-service-cancel.md).
- Recovery-email timing on the daily cron, and the party "purchaser" being the first-named diver
  rather than a verified who's-paying field —
  [20260726-abandoned-checkout-recovery](../architecture/decisions/20260726-abandoned-checkout-recovery.md).
- Per-trip (rather than per-shop) ratings, replies to reviews, and any third-party review widget —
  [20260729-verified-diver-reviews](../architecture/decisions/20260729-verified-diver-reviews.md).
