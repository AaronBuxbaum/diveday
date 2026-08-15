# 20260815-pos-order-emission-completeness — Every dive-day purchase, including $0 comps, is a complete emitted order; DiveDay never becomes a retail POS

- **Status:** Proposed
- **Date:** 2026-08-15

**Proposed, deliberately.** A scope-and-policy decision, not new engineering — it depends entirely
on [20260815-outbound-integration-webhooks-and-zapier](20260815-outbound-integration-webhooks-and-zapier.md)
for its transport and adds no infrastructure of its own. This record exists so "plug into the POS"
has one settled meaning instead of being re-litigated per feature request.

## Context

The originating inquiry described a POS as "the glue that ties it all together" — the front end
where staff create special orders, rental or service bookings, class enrollments, and trip
additions, with every action (even a giveaway) tied back to it as a purchase. The product owner's
clarification reframes the ask precisely: *"functionality that plugs into the POS, not building the
POS itself."*

Checked against the running code, DiveDay already **is** the ledger for every one of those actions —
just not through a register UI:

- `orders` / `order_line_items` already has a `kind` enum covering `trip_fee`, `course_fee`,
  `e_learning_fee`, `rental`, `nitrox`, `deposit`, `merchandise`, and `other` (free-form, for
  anything the catalog doesn't anticipate).
- Every one of "create a special order," "establish a rental booking," "enroll in a class," "add to
  a trip" already happens through DiveDay's own front desk (`bookings/new`, course enrollment,
  `seat-diver.ts`) — never a separate register a staff member switches to.
- **A giveaway is already representable, not a gap:** `PROMO_DISCOUNT_MAX = 100`
  (`src/lib/promo-codes.ts`) means a 100%-off code produces a normal `paid` order with $0 collected
  and full line items intact — nothing about "comp'd" requires new domain modeling.

So the actual gap is not domain modeling — it's that none of this reaches a shop's own POS or
accounting system today. `vision.md`'s non-goals (this session's edit) already rule out DiveDay
growing a general retail register: gear *rental* only, never selling or repairing items. This ADR
is the boundary statement that keeps "plugs into the POS" from quietly becoming "builds a POS."

Constraints a lower-context agent must not miss:

- DiveDay already collects payment through the shop's own connected Stripe account
  ([20260719-stripe-connect-orders](20260719-stripe-connect-orders.md)). Any integration that also
  creates a *paid* order object in a shop's retail POS risks double-counting revenue between the
  two systems — this is the failure mode this ADR is written to prevent, not just note.
- `order_line_items.kind`'s `other`/`merchandise` values exist for "shops will invoice things this
  catalog doesn't anticipate" about a *dive-day* order — not as a side door into general retail
  sale tracking. `vision.md` already declines barcode/SKU inventory and work orders explicitly.

## Decision

**No new domain modeling. Add `order.paid` / `order.voided` / `order.refunded` to the webhook
ADR's event catalog, each payload carrying the order plus every line item verbatim — kind,
description, quantity, unit amount, never a summarized total.** A $0-collected order (a comp) emits
identically to a paid one, differing only in the amount, so a receiving accounting system sees the
giveaway exactly as it happened rather than as nothing.

DiveDay is never the origination point for a transaction it didn't create itself. No inbound
surface is built for "create an order in DiveDay from the POS" — a shop ringing up unrelated retail
merchandise does that entirely in its own system, which never talks to DiveDay for that
transaction. The `merchandise`/`other` line kinds remain the ceiling for what DiveDay bills
directly (a staff-typed description and amount attached to an existing dive-day order) — explicitly
not a path toward a product catalog, SKUs, or a stock count, which stay declined.

## Alternatives considered

- **Push a DiveDay order into Shopify/DiveShop360 as a real, paid order object**, so the shop's own
  revenue reports include it directly — rejected as the default: DiveDay already collects the
  payment, so a second paid-order record on the POS side is exactly the double-counting risk named
  above. If a shop wants a record-only, non-collecting order created on their own POS from the
  emitted event, that's their own Zap to build from the webhook payload — not DiveDay's default
  shape.
- **Build a DiveDay-specific QuickBooks sync** — rejected for the same reason the webhook ADR
  declines a bespoke Shopify app: Zapier/Make already has a native QuickBooks connector, so the
  emitted `order.paid` event is sufficient without DiveDay writing accounting-specific code.
- **Let staff use the `other` line kind as a general-purpose retail-sale entry point** — explicitly
  rejected as a documented ceiling rather than left to grow silently: it exists for edge cases on a
  *dive-day* order, not as an unstated path into general retail, and no catalog/barcode/stock
  feature will ever be layered onto it.
- **Summarize the payload to an order total** — rejected; a $0 comp with no line items is
  indistinguishable from nothing happening, which defeats the entire "even a giveaway is tracked"
  requirement.

## Consequences

- **Easy:** zero schema change — this is a payload-completeness and scope decision layered on the
  webhook ADR, not new engineering.
- **Hard:** the discipline of *not* letting `other`/`merchandise` grow into a catalog is a standing
  policy this ADR states out loud but cannot enforce in code by itself — worth a comment on the
  enum definition pointing back here, the same way `rental_fit_profiles` warns against reservation
  semantics creeping in.
- **Commits us to:** order/line-item shape as a de facto public API surface once a real external
  consumer exists — the same versioning discipline the webhook ADR already commits to.
- **Escape hatch:** none independent of the webhook ADR's — this decision has no infrastructure of
  its own to unwind; if it's never used, the cost is nothing beyond three unused event types in an
  otherwise-adopted catalog.
