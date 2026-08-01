# FareHarbor feature-gap audit — the schedule/embed flank and beyond

> ✅ **Closed 2026-07-30 and archived.** Every row below has either shipped or left this document.
> What shipped: the embeddable schedule/booking widget, abandoned-cart recovery, post-trip
> review-request email (plus tipping), diver self-service cancel/reschedule, shop-wide promo codes,
> verified diver reviews, and booking-page structured data — each linked inline and indexed in
> [shipped.md](../shipped.md). What didn't: **gift cards** and **private/buyout charters** now live in
> [roadmap.md](../roadmap.md#not-scheduled--candidate-subsystems), which is where to plan them from.
> **Diver-selectable upsells at checkout** and **multi-currency** were both deferred here and have
> since shipped (see [shipped.md](../shipped.md)). Per-feature rough edges on the
> shipped work stay in the *Consequences* of their ADRs. Kept for the FareHarbor sourcing and the
> reasoning; **not open work — do not plan from this file.**

> A feature-level audit, not a positioning argument. [fareharbor-positioning.md](../assessments/fareharbor-positioning.md)
> already sets the strategic frame (coexist-led, leave-clean) and is the source of truth for how we
> talk about FareHarbor's business model, fees, and distribution network — don't re-litigate that
> here. This document instead asks a narrower question: **what can a diver or shop owner *do* on
> FareHarbor's booking surface that they cannot do on DiveDay's, feature for feature?** Written
> 2026-07-26 from FareHarbor's own Help Center and product blog (cited per row) checked against the
> running codebase (verified by direct file read, cited per row). An assessment, not a commitment;
> items that survive review move to [roadmap.md](../roadmap.md).

## Why this is a different cut than the existing docs

[competitive-analysis.md](../assessments/competitive-analysis.md) and [competitive-strategy.md](../assessments/competitive-strategy.md)
already cover the ground that decides *whether a shop buys DiveDay at all*: payment-at-booking, waivers,
manifests, pricing, portability. Those are closed or in flight. This audit looks instead at the
**growth and convenience layer** FareHarbor has built on top of its checkout — the features that don't
block a sale but do compound revenue and reach for a shop that has them, and that a shop switching
*away* from FareHarbor (or comparing side by side) will notice are missing. With one exception —
self-service reschedule/cancel mutates manifest and payment/refund state through a new
diver-triggered surface, which AGENTS.md's hard rules place in the same safety-critical bucket as
roll call and cert gating (see "Implications for the queue" below) — none of these are
safety-critical; several are genuinely low-effort relative to their payoff.

## 1. The schedule page has no embed story — the trigger for this audit

> ✅ **Shipped 2026-07-26**, in the same PR this audit landed in — see
> [20260726-schedule-embed](../../architecture/decisions/20260726-schedule-embed.md) and
> [shipped.md](../shipped.md#schedule-embed-widget-delivered-2026-07-26). The research below is kept
> as the record of the gap and the FareHarbor sourcing that motivated the build; it is not open work.

FareHarbor's core distribution mechanic is **not** its own hosted booking page — it's the embed. A
shop's existing website (WordPress, Squarespace, whatever they already have) stays the site the diver
finds via Google/social/word of mouth, and FareHarbor supplies the piece that goes *inside* it: an
embed generator producing a `<script>`/iframe snippet for a responsive availability calendar, a
"Book Now" button that opens their Lightframe overlay, or a WordPress plugin with shortcodes for the
same
([Adding FareHarbor links and embeds to your website](https://help.fareharbor.com/hc/en-us/articles/40898512663451-Adding-FareHarbor-links-and-embeds-to-your-website),
[Custom Embed Generator](https://help.fareharbor.com/hc/en-us/articles/40898520358939-FareHarbor-Custom-Embed-Generator),
[FareHarbor for WordPress](https://wordpress.org/plugins/fareharbor/)). The shop's brand and domain stay
front and center; checkout is the only part that visibly leaves.

DiveDay has no equivalent. The public schedule (`src/app/shop/[shopSlug]/schedule/page.tsx`) and trip
page (`src/app/shop/[shopSlug]/schedule/[id]/page.tsx`) exist only as DiveDay-hosted pages at
`/shop/[shopSlug]/schedule`; there is no `<script>` widget, no iframe-optimized rendering mode, no
"Book Now" button generator, and no shop-facing config UI to produce one. `next.config.ts` sets no
frame-related headers at all, so nothing today would technically block a raw `<iframe src="...">` —
but that's an accident of omission, not a supported path. To be precise about what's actually missing:
the anonymous-visitor page is already fairly chrome-light — the root layout (`src/app/layout.tsx`)
renders no header/nav/footer shell of its own, and `src/app/shop/[shopSlug]/layout.tsx` mounts `ShopNav`
only when `session?.user` exists, so a signed-out diver never sees staff nav. The real gap is narrower
than "strip the chrome": there is no snippet/embed generator, no compact single-trip or "Book Now"
rendering mode sized for an iframe, no shop-facing config UI to produce one, and the page still carries
its own DiveDay page metadata/title/OG tags and `ShopPageHeader` eyebrow rather than a minimal
embed-shaped surface a shop's site would want.

**Why it matters:** most dive shops already have a website they've invested in (SEO, domain authority,
brand) and do not want to abandon it for a directory-style booking page. FareHarbor's embed is how it
respects that — the shop keeps its site, DiveDay/FareHarbor just answers "can I book this." Today, a
shop moving to DiveDay has to either send traffic to a `diveday`-branded URL or accept a fully custom
build to reproduce what FareHarbor gives out of a settings page. This is a genuine, verifiable, and
fixable gap, not a strategic concession like the distribution network (which
[fareharbor-positioning.md](../assessments/fareharbor-positioning.md) already correctly concedes).

**Suggested shape (not a commitment):** a compact, embed-shaped rendering mode for the schedule/trip
pages (own route or query param — own metadata, no page-level eyebrow/header, sized for an iframe), plus
a small, dependency-free embed script the shop can paste — start with "Book Now" button + single-trip
embed before a full calendar widget, since the schedule page's month calendar already exists and mostly
needs a minimal shell, not chrome removal.

## 2. Other feature gaps found, verified against the running code

| Feature | FareHarbor has it | DiveDay today | Verdict |
| --- | --- | --- | --- |
| Promo / discount codes | Operator-configured codes at checkout ([Discount codes](https://help.fareharbor.com/hc/en-us/articles/42957480670363-Discount-codes)) | ✅ **Shipped 2026-07-29** — shop-wide percent-off codes with scope, window, and redemption cap, minted on the shop's own Stripe account, plus a redemption history ([20260729-shop-promo-codes](../../architecture/decisions/20260729-shop-promo-codes.md)). One code per checkout; a trip-scoped last-minute deal still wins over a shop-wide one. *Originally recorded as:* **Absent, and there's no durable model to hang it on.** No discount/promo/coupon logic in `src/lib/payments/checkout.ts` or `src/db/orders.ts`, and the schema has nowhere to define a shop's codes, validity windows, eligibility, or usage limits — nor do checkout/order rows snapshot an applied code or redemption for later cancellation/refund auditing (one unrelated comment about a rental "full-set discount" in `src/lib/rentals.ts:147`) | Done — the promotion model this row said had to exist is what shipped. Fixed-amount (rather than percent) discounts and auto-applied codes remain deliberately unbuilt |
| Gift cards | Sold, redeemed, and managed from the Dashboard, usable on any activity ([Gift card overview](https://help.fareharbor.com/hc/en-us/articles/40897463478555-Gift-card-overview)) | **Absent.** Zero references anywhere in `src` | Moved 2026-07-30 to [roadmap.md](../roadmap.md#gift-cards). *Original verdict:* real revenue lever (holiday/gifting season) but non-trivial — needs a stored-value ledger, not just a checkout tweak |
| Add-ons / upsells at checkout | Combos (pick-your-own add-ons) and Packages (pre-bundled, up to 3 items booked together) directly in the book flow ([Combos](https://fareharbor.com/blog/maximize-sales-and-customer-satisfaction-introducing-fareharbor-combos/), [Packages](https://fareharbor.com/blog/how-to-turn-your-best-tour-and-activity-offerings-into-high-performing-packages/)) | **Absent as a diver self-serve flow, and the booking order makes it harder than "just charge the existing quote."** `checkout.ts` builds exactly one Stripe line item per trip/course fee. Rental *fit* pricing is real (`RentalPricing`/`quoteRentalFit` in `src/lib/rentals.ts`, shop-configured prices, the diver-facing quote in `RentalFitForm`) — but in the public flow, `bookSpot` sends the diver straight to Stripe *before* `RentalFitForm` ever renders (it's on the post-booking confirmation page), so no rental selection or quote exists yet when the first checkout session is created. Staff can add line items post-booking (`src/app/shop/[shopSlug]/orders/new/page.tsx`), but a diver can't add anything while booking | Moved 2026-07-30 to future-features.md §1 (shipped 2026-08-01; see [shipped.md](../shipped.md#diver-selectable-checkout-upsells--rental-gear-delivered-2026-08-01)). *Original verdict:* the pricing math is shipped, but charging it needs either moving rental selection ahead of the first checkout or a separate post-booking payment flow — not just snapshotting an existing quote onto the first session |
| Self-service reschedule/cancel | Guests can rebook or cancel their own reservation online ([Exceptional Customer Experience](https://fareharbor.com/sell/customer-experience/)) | ✅ **Shipped 2026-07-27** — `/ready/[token]` now offers a diver-facing cancel/reschedule for an unpaid booking; reschedule is atomic book-then-cancel so the diver is never left seatless, and cancel reuses the existing automated-refund logic. Reviewed by `dive-domain-expert` and `security-reviewer` per the safety-critical/security-sensitive note this row originally flagged | Done — see [shipped.md](../shipped.md#diver-self-service-booking-cancelreschedule-delivered-2026-07-27) and [20260727-diver-self-service-cancel](../../architecture/decisions/20260727-diver-self-service-cancel.md); a paid/deposit-paid/waived booking still requires staff to reschedule |
| Abandoned-cart recovery | Automatic recovery email ~2 hours after checkout abandonment, claimed ~20% recovery rate vs. 2.4% industry average ([Abandoned Cart Recovery](https://fareharbor.com/blog/say-goodbye-to-lost-bookings-with-new-abandoned-cart-recovery-feature/)) | ✅ **Shipped 2026-07-26**, same PR — [20260726-abandoned-checkout-recovery](../../architecture/decisions/20260726-abandoned-checkout-recovery.md). `customerEmail` is now stored durably on `booking_checkouts` at creation time (`src/db/schema.ts`), populated from `validParty[0]?.email` at the moment the checkout session is created (`startCheckoutUrl` in `src/app/shop/[shopSlug]/schedule/[id]/actions.ts:262`) instead of re-derived later from the party's linked bookings; every candidate is reconciled directly against Stripe before sending, and a cancelled trip or linked booking is excluded | Done — the reconciliation and recipient-storage gaps this row originally flagged are exactly what the shipped version closes. Two residual, non-blocking limitations: cron-granularity timing (see the ADR's consequences), and for a *party* booking the "purchaser" is still an assumption (the first-named diver on the form), not a distinct verified who's-paying field — reasonable since that diver is the one who continues straight into Stripe Checkout, but not a guarantee |
| Private/group charter booking | Private Events tool: proposals, contracts, deposits, and resource-blocking for buyout-style bookings ([Private Events](https://fareharbor.com/sell/private-events/)) | **Party booking already exists; the private/buyout workflow is the actual gap.** The public form already books a party of up to six atomically (`createBookingParty`) with one shared checkout (`startBookingCheckout`, `src/app/shop/[shopSlug]/schedule/[id]/actions.ts:115-151`, `src/db/checkouts.test.ts:129-148`) — so "group booking" is shipped. What FareHarbor's Private Events adds and DiveDay doesn't have is the buyout-a-whole-trip proposal/contract/resource-blocking workflow; "charter" elsewhere in the code is just a synonym for a scheduled trip (`src/db/seed.ts`, `src/db/schema.ts`), consistent with the roadmap's existing note that there is no boat/resource entity (`roadmap.md` §5) | Moved 2026-07-30 to [roadmap.md](../roadmap.md#private--buyout-charters). *Original verdict:* real dive-shop use case (buyout charters, bachelor/corporate groups), but scope it as the buyout workflow on top of shipped party booking, not a rebuild — and it overlaps the already-open "no boat entity" roadmap item, so solve them together |
| Reviews / ratings display | TripAdvisor widget + Review Express integration, plus FareHarbor's own post-tour review-request emails ([Top Review Platforms](https://fareharbor.com/blog/top-review-platforms-for-tour-activity-operators/)) | ⚠️ **Partially shipped 2026-07-26.** The recap page (`/recap/[token]`) now shows a "Leave a review" CTA when the shop has set `shops.review_url` (Settings → Review link), asked right after the trip's earned-moment hero. Not shipped: a duplicate ask inside `tripRecapEmail` itself (the recap link it already sends is the funnel), and any internal rating/testimonial display — FareHarbor's TripAdvisor widget embed is not reproduced | Done — an internal, *verified* ratings display shipped 2026-07-29 ([20260729-verified-diver-reviews](../../architecture/decisions/20260729-verified-diver-reviews.md)): a diver rates from their own recap link, so unlike a TripAdvisor widget every review provably comes from someone who was on the boat. Embedding a third-party widget stays deliberately unbuilt |
| Multi-currency | Standard on a global booking platform | **Absent.** `orders.ts:111` hardcodes `const currency = "usd"`; schema columns default to `"usd"` throughout `schema.ts` | Non-issue for the US-first launch; only matters if/when international shops are targeted — don't build ahead of demand. Carried forward as future-features.md's *Not until demand pulls* entry, and **since shipped**: a shop declares its own currency and every amount is stored and displayed in it ([20260731-shop-currency](../../architecture/decisions/20260731-shop-currency.md)) |
| Structured data (SEO) on booking pages | Not FareHarbor-specific, but their marketplace pages carry rich snippets | ✅ **Shipped 2026-07-29** — `ItemList`/`Event`/`Course` JSON-LD plus per-shop titles and canonical URLs on the schedule, trip, and course pages, carrying price, remaining seats, and the shop's verified rating ([20260729-booking-page-structured-data](../../architecture/decisions/20260729-booking-page-structured-data.md)) | Done — and the embed/canonical question this row was waiting on was exactly what unblocked it |

## What's *not* a gap, despite the FareHarbor comparison

- **Waitlist** — already shipped, self-join, no staff required (`src/db/waitlist.ts`,
  [shipped.md](../shipped.md), ADR `20260719-trip-waitlist.md`). FareHarbor markets this as a newer
  feature; DiveDay already has it.
- **Multiple bookable product types** — trips and courses are both independently schedulable
  (`src/db/course-templates.ts`), so this isn't a single-product system the way the audit might have
  suggested; the real gap is rentals/gear as a *sellable* line item, captured above under add-ons.
- **Group bookings** — a party of up to six books and checks out together in one atomic flow already;
  see the private/group charter row above for what's actually missing (the buyout workflow).
- **Distribution network / OTA listing** — already conceded explicitly and correctly in
  [fareharbor-positioning.md](../assessments/fareharbor-positioning.md#why-fareharbor-is-a-different-fight); not
  re-litigated here.

## How this closed (2026-07-30)

The audit's original queue advice was that this is growth-layer, not safety-critical, so none of it
should jump ahead of V-02 (field-validate the offline manifest) or the open portability build items.
Self-service cancel/reschedule was the one exception — it mutates manifest and payment/refund state
through a new diver-triggered surface, which AGENTS.md's hard rules place in the same safety-critical
bucket as roll call and cert gating — and it shipped with the required
`dive-domain-expert`/`security-reviewer` reviews. Final disposition of every row:

**Shipped**, indexed in [shipped.md](../shipped.md) with an ADR each: the **embeddable
schedule/booking widget** (this audit's own trigger), **abandoned-cart recovery email**, **post-trip
review-request email** (bundled with **post-trip tipping**, an addition outside this audit's original
findings), **diver self-service cancel/reschedule**, **shop-wide promo/discount codes**, the internal
**verified-reviews display**, and **booking-page structured data**. See
[shipped.md](../shipped.md#schedule-embed-widget-delivered-2026-07-26),
[shipped.md](../shipped.md#post-trip-review-request-delivered-2026-07-26),
[shipped.md](../shipped.md#post-trip-crew-tipping-delivered-2026-07-26), and
[shipped.md](../shipped.md#diver-self-service-booking-cancelreschedule-delivered-2026-07-27).

**Not built, and now tracked in [roadmap.md](../roadmap.md#not-scheduled--candidate-subsystems)** — each is closer to a
new subsystem than a slice, and each needs an ADR before it starts: **diver-selectable upsells at
checkout** (§1, highest leverage per effort since the rental pricing already ships), **gift cards**
(§2, a stored-value ledger and a jurisdictional unclaimed-balance question), and **private/buyout
charters** (§3, to be designed with the still-open "no boat entity" roadmap item, §5).
**Multi-currency** carries over there as an explicit don't-build-ahead-of-demand entry.

**Left deliberately unbuilt on shipped features** — fixed-amount and auto-applied discount codes,
self-service reschedule of a *paid* booking, recovery-email timing on the daily cron, per-trip
ratings, and any third-party review widget. Each is recorded in the *Consequences* of the ADR that
shipped its feature, which stays the place to look; [roadmap.md](../roadmap.md#not-scheduled--candidate-subsystems) lists
where.

Nothing on this list is open work. Plan from [roadmap.md](../roadmap.md) and
[roadmap.md](../roadmap.md#not-scheduled--candidate-subsystems).
