# Vision

**One place to run a dive shop — bookings, waivers, cert checks, gear, and boat manifests —
that is a genuine pleasure to use.**

## The problem

Dive shop software exists (EVE, DiveShop360, Bloowatch, spreadsheets + paper clipboards), but it
is uniformly utilitarian at best and hostile at worst: dated UIs, desktop-bound workflows, forms
that fight you. Shops tolerate it because the domain plumbing (agencies, waivers, manifests) is
annoying to rebuild. Nobody has won on experience.

## The bet

**Delight is the differentiator.** Feature parity on the five pillars is table stakes; we win by
being the product that staff *want* to open — fast, beautiful, forgiving, and usable on a wet
phone at the dock. See [design/principles.md](../design/principles.md) for what delight means
concretely here.

## The five pillars

1. **Bookings** — trips, courses, and charters; capacity-aware scheduling; a public booking flow
   a diver finishes in under a minute.
2. **Waivers** — templated releases signed before arrival, stored durably, attached to the
   person and the booking. No printer anywhere in the flow.
3. **Cert checks** — record divers' agency cards (PADI, SSI, NAUI, …), verify levels against a
   trip's requirements up front, so the dock stays drama-free.
4. **Gear** — rental *fit*: the sizes each diver takes from the shop, feeding trip prep and
   packing lists. Beneath it, opt-in by presence, the **gear register**: the shop's own fleet as
   tagged units, per-unit service clocks (tank hydro/VIP, regulator service), and date-ranged
   reservations with a database-level double-booking guard — rental only, never selling or
   repairing (see the non-goals;
   [20260815-minimal-gear-register](../architecture/decisions/20260815-minimal-gear-register.md)).
   A shop with no tracked fleet sees none of it.
5. **Boat manifests** — who's aboard, who's certified for the sites, roll call before departure
   and after every dive. A safety document first, a UI second.

## Who it's for

- **Shop owner / manager** — configures the shop, watches the calendar and the money.
- **Front desk staff** — creates bookings, checks divers in, chases missing waivers/certs.
- **Instructor / divemaster** — sees their schedule, their students, their boat.
- **Boat captain / crew** — runs the manifest and roll call, often offline, always in sunlight.
- **The diver (customer)** — books, signs, uploads a cert. Never needs an account manual.

## Non-goals (for now)

- Not a dive-agency LMS (we track certs, we don't issue them).
- Not a general POS/retail system — DiveDay manages gear *rental* only, never **selling** items
  (retail/barcode inventory) or **repairing** them (work orders, parts, labor). A shop's existing
  POS stays authoritative for both. **No other system is ever authoritative for DiveDay's own
  data** either: a connector may push DiveDay's facts out and read back only enough to stay
  idempotent, never sync a provider's inventory, orders or certifications back in. Within that
  line DiveDay *does* call a provider's API when a shop authorizes it — Shopify and QuickBooks
  Online today — on private apps that are never submitted to a public app directory, because the
  cost H-26 rules out is the review-and-support relationship, not the outbound call
  ([20260827-shop-authorized-provider-connectors](../architecture/decisions/20260827-shop-authorized-provider-connectors.md),
  superseding the earlier "emit only" rule). For everything not on that short register, the path is
  still a no-code bridge (Zapier/Make) the shop wires to DiveDay's own events
  ([features/roadmap.md](features/roadmap.md#1-data-portability-follow-ons-the-wedge)).
- Not a dive-log social network.

## What kind of business this is

**DiveDay is a deliberately bounded, founder-run lifestyle business — not a venture-scale
trajectory.** No outside capital, no aggressive multi-shop growth target. Decided explicitly
2026-08-02 (H-26, `docs/product/human-decisions.md`), because the commercial terms already in
place only make sense under this reading and nothing had said so out loud: the **$99 flat
price**, **no platform fee**, the **25-shop founding cohort cap**, and the **two-year price lock**
(H-12) are all consistent with a small, bounded customer base one person can actually run —
they are not a placeholder pending a pricing rework for scale. If that changes — outside capital,
a real plan to grow past a founder-sized support load — revisit this statement and the commercial
terms together, before any new cohort lock binds. The published support promise stays a
founder-direct line (a real person, not a ticket queue) without a stated response-time SLA, since
what one person can sustainably commit to at the founding cohort's eventual size is still an open
question.

## Success signal

Staff at a busy shop choose to run the whole day from it — unprompted — and a diver compliments
the booking flow. Retention over feature count.
