# FareHarbor feature-gap audit — the schedule/embed flank and beyond

> A feature-level audit, not a positioning argument. [fareharbor-positioning.md](fareharbor-positioning.md)
> already sets the strategic frame (coexist-led, leave-clean) and is the source of truth for how we
> talk about FareHarbor's business model, fees, and distribution network — don't re-litigate that
> here. This document instead asks a narrower question: **what can a diver or shop owner *do* on
> FareHarbor's booking surface that they cannot do on DiveDay's, feature for feature?** Written
> 2026-07-26 from FareHarbor's own Help Center and product blog (cited per row) checked against the
> running codebase (verified by direct file read, cited per row). An assessment, not a commitment;
> items that survive review move to [roadmap.md](../roadmap.md).

## Why this is a different cut than the existing docs

[competitive-analysis.md](competitive-analysis.md) and [competitive-strategy.md](competitive-strategy.md)
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
fixable gap, not a strategic concession like the distribution network (which fareharbor-positioning.md
already correctly concedes).

**Suggested shape (not a commitment):** a compact, embed-shaped rendering mode for the schedule/trip
pages (own route or query param — own metadata, no page-level eyebrow/header, sized for an iframe), plus
a small, dependency-free embed script the shop can paste — start with "Book Now" button + single-trip
embed before a full calendar widget, since the schedule page's month calendar already exists and mostly
needs a minimal shell, not chrome removal.

## 2. Other feature gaps found, verified against the running code

| Feature | FareHarbor has it | DiveDay today | Verdict |
| --- | --- | --- | --- |
| Promo / discount codes | Operator-configured codes at checkout ([Discount codes](https://help.fareharbor.com/hc/en-us/articles/42957480670363-Discount-codes)) | **Absent, and there's no durable model to hang it on.** No discount/promo/coupon logic in `src/lib/payments/checkout.ts` or `src/db/orders.ts`, and the schema has nowhere to define a shop's codes, validity windows, eligibility, or usage limits — nor do checkout/order rows snapshot an applied code or redemption for later cancellation/refund auditing (one unrelated comment about a rental "full-set discount" in `src/lib/rentals.ts:147`) | Not just "a second line-item adjustment" — a real promotion model (codes, limits, redemption history) has to exist before the server can even validate a submitted code |
| Gift cards | Sold, redeemed, and managed from the Dashboard, usable on any activity ([Gift card overview](https://help.fareharbor.com/hc/en-us/articles/40897463478555-Gift-card-overview)) | **Absent.** Zero references anywhere in `src` | Real revenue lever (holiday/gifting season) but non-trivial: needs a stored-value ledger, not just a checkout tweak |
| Add-ons / upsells at checkout | Combos (pick-your-own add-ons) and Packages (pre-bundled, up to 3 items booked together) directly in the book flow ([Combos](https://fareharbor.com/blog/maximize-sales-and-customer-satisfaction-introducing-fareharbor-combos/), [Packages](https://fareharbor.com/blog/how-to-turn-your-best-tour-and-activity-offerings-into-high-performing-packages/)) | **Absent as a diver self-serve flow, and the booking order makes it harder than "just charge the existing quote."** `checkout.ts` builds exactly one Stripe line item per trip/course fee. Rental *fit* pricing is real (`RentalPricing`/`quoteRentalFit` in `src/lib/rentals.ts`, shop-configured prices, the diver-facing quote in `RentalFitForm`) — but in the public flow, `bookSpot` sends the diver straight to Stripe *before* `RentalFitForm` ever renders (it's on the post-booking confirmation page), so no rental selection or quote exists yet when the first checkout session is created. Staff can add line items post-booking (`src/app/shop/[shopSlug]/orders/new/page.tsx`), but a diver can't add anything while booking | The pricing math is shipped, but charging it needs either moving rental selection ahead of the first checkout or a separate post-booking payment flow — not just snapshotting an existing quote onto the first session |
| Self-service reschedule/cancel | Guests can rebook or cancel their own reservation online ([Exceptional Customer Experience](https://fareharbor.com/sell/customer-experience/)) | ✅ **Shipped 2026-07-27** — `/ready/[token]` now offers a diver-facing cancel/reschedule for an unpaid booking; reschedule is atomic book-then-cancel so the diver is never left seatless, and cancel reuses the existing automated-refund logic. Reviewed by `dive-domain-expert` and `security-reviewer` per the safety-critical/security-sensitive note this row originally flagged | Done — see [shipped.md](../shipped.md#diver-self-service-booking-cancelreschedule-delivered-2026-07-27) and [20260727-diver-self-service-cancel](../../architecture/decisions/20260727-diver-self-service-cancel.md); a paid/deposit-paid/waived booking still requires staff to reschedule |
| Abandoned-cart recovery | Automatic recovery email ~2 hours after checkout abandonment, claimed ~20% recovery rate vs. 2.4% industry average ([Abandoned Cart Recovery](https://fareharbor.com/blog/say-goodbye-to-lost-bookings-with-new-abandoned-cart-recovery-feature/)) | ✅ **Shipped 2026-07-26**, same PR — [20260726-abandoned-checkout-recovery](../../architecture/decisions/20260726-abandoned-checkout-recovery.md). `customerEmail` is now stored durably on `booking_checkouts` at creation time (`src/db/schema.ts`), populated from `validParty[0]?.email` at the moment the checkout session is created (`startCheckoutUrl` in `src/app/shop/[shopSlug]/schedule/[id]/actions.ts:262`) instead of re-derived later from the party's linked bookings; every candidate is reconciled directly against Stripe before sending, and a cancelled trip or linked booking is excluded | Done — the reconciliation and recipient-storage gaps this row originally flagged are exactly what the shipped version closes. Two residual, non-blocking limitations: cron-granularity timing (see the ADR's consequences), and for a *party* booking the "purchaser" is still an assumption (the first-named diver on the form), not a distinct verified who's-paying field — reasonable since that diver is the one who continues straight into Stripe Checkout, but not a guarantee |
| Private/group charter booking | Private Events tool: proposals, contracts, deposits, and resource-blocking for buyout-style bookings ([Private Events](https://fareharbor.com/sell/private-events/)) | **Party booking already exists; the private/buyout workflow is the actual gap.** The public form already books a party of up to six atomically (`createBookingParty`) with one shared checkout (`startBookingCheckout`, `src/app/shop/[shopSlug]/schedule/[id]/actions.ts:115-151`, `src/db/checkouts.test.ts:129-148`) — so "group booking" is shipped. What FareHarbor's Private Events adds and DiveDay doesn't have is the buyout-a-whole-trip proposal/contract/resource-blocking workflow; "charter" elsewhere in the code is just a synonym for a scheduled trip (`src/db/seed.ts`, `src/db/schema.ts`), consistent with the roadmap's existing note that there is no boat/resource entity (`roadmap.md` §5) | Real dive-shop use case (buyout charters, bachelor/corporate groups), but scope it as the buyout workflow on top of shipped party booking, not a rebuild — and it overlaps the already-open "no boat entity" roadmap item, so solve them together |
| Reviews / ratings display | TripAdvisor widget + Review Express integration, plus FareHarbor's own post-tour review-request emails ([Top Review Platforms](https://fareharbor.com/blog/top-review-platforms-for-tour-activity-operators/)) | ⚠️ **Partially shipped 2026-07-26.** The recap page (`/recap/[token]`) now shows a "Leave a review" CTA when the shop has set `shops.review_url` (Settings → Review link), asked right after the trip's earned-moment hero. Not shipped: a duplicate ask inside `tripRecapEmail` itself (the recap link it already sends is the funnel), and any internal rating/testimonial display — FareHarbor's TripAdvisor widget embed is not reproduced | Destination-and-ask mechanism done; an internal ratings display (or embedding TripAdvisor/Google's own widget) remains open if a shop asks for it |
| Multi-currency | Standard on a global booking platform | **Absent.** `orders.ts:111` hardcodes `const currency = "usd"`; schema columns default to `"usd"` throughout `schema.ts` | Non-issue for the US-first launch; only matters if/when international shops are targeted — don't build ahead of demand |
| Structured data (SEO) on booking pages | Not FareHarbor-specific, but their marketplace pages carry rich snippets | **Partial.** JSON-LD (`FAQPage`/`SoftwareApplication`) exists on marketing pages (`src/app/page.tsx`, `src/app/pricing/page.tsx`) but not on the public schedule/trip pages that are actually the booking surface | Cheap, no-risk SEO win once the embed/standalone-page question above is settled (structured data belongs on whichever URL is canonical) |

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
  [fareharbor-positioning.md](fareharbor-positioning.md#why-fareharbor-is-a-different-fight); not
  re-litigated here.

## Implications for the queue

Most of this is growth-layer, not safety-critical, so it shouldn't jump ahead of V-02 (field-validate
the offline manifest) or the open portability build items. Self-service cancel/reschedule was the one
exception — it mutates manifest and payment/refund state through a new diver-triggered surface, which
AGENTS.md's hard rules place in the same safety-critical bucket as roll call and cert gating — and it
has since shipped with the required `dive-domain-expert`/`security-reviewer` reviews (see below). In
rough order of leverage per effort otherwise, for whoever next grooms [roadmap.md](../roadmap.md):

1. **Rental gear as a priced, diver-selectable add-on at checkout** — the pricing already exists
   (`RentalPricing`/`quoteRentalFit`, shop-configured prices, the diver-facing quote in
   `RentalFitForm`); what's missing is charging that quote at checkout and snapshotting it on the
   order, not building a price from scratch.
2. **Promo/discount codes** need real design work (discount-stacking rules), so it's sequenced after
   the above.
3. **Gift cards** and **the private/buyout charter workflow** — real revenue levers, but each is
   closer to a new subsystem (stored-value ledger; resource/boat modeling + proposal/contract flow on
   top of the party booking that already ships) than a slice on top of what exists. Private charters
   should be designed together with the already-open "no boat entity" roadmap item (§5), not as a
   separate effort.
4. **Multi-currency** and **SEO structured data on booking pages** — leave multi-currency until
   international demand is real; structured data is cheap but should wait now that the schedule embed
   has settled which URL is canonical.

Already shipped, in the same PR this audit landed in: **abandoned-cart recovery email**, the
**embeddable schedule/booking widget** (this audit's own trigger), **post-trip review-request
email** (bundled with **post-trip tipping**, an addition outside this audit's original findings), and
**diver self-service cancel/reschedule** — see
[shipped.md](../shipped.md#schedule-embed-widget-delivered-2026-07-26),
[shipped.md](../shipped.md#post-trip-review-request-delivered-2026-07-26),
[shipped.md](../shipped.md#post-trip-crew-tipping-delivered-2026-07-26), and
[shipped.md](../shipped.md#diver-self-service-booking-cancelreschedule-delivered-2026-07-27) for what
shipped and the linked ADRs for what each decided.
