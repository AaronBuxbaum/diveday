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
*away* from FareHarbor (or comparing side by side) will notice are missing. None of these are
safety-critical; several are genuinely low-effort relative to their payoff.

## 1. The schedule page has no embed story — the trigger for this audit

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
but that's an accident of omission, not a supported path: the page still carries the full DiveDay chrome
(header, nav, branding) with nothing built to strip it down for embedding, and there's no snippet
generator a shop could actually copy-paste.

**Why it matters:** most dive shops already have a website they've invested in (SEO, domain authority,
brand) and do not want to abandon it for a directory-style booking page. FareHarbor's embed is how it
respects that — the shop keeps its site, DiveDay/FareHarbor just answers "can I book this." Today, a
shop moving to DiveDay has to either send traffic to a `diveday`-branded URL or accept a fully custom
build to reproduce what FareHarbor gives out of a settings page. This is a genuine, verifiable, and
fixable gap, not a strategic concession like the distribution network (which fareharbor-positioning.md
already correctly concedes).

**Suggested shape (not a commitment):** an iframe-friendly rendering mode for the schedule/trip pages
(strip nav/footer via a query param or dedicated route), plus a small, dependency-free embed script the
shop can paste — start with "Book Now" button + single-trip embed before a full calendar widget, since
the schedule page's month calendar already exists and mostly needs a chrome-less shell.

## 2. Other feature gaps found, verified against the running code

| Feature | FareHarbor has it | DiveDay today | Verdict |
| --- | --- | --- | --- |
| Promo / discount codes | Operator-configured codes at checkout ([Discount codes](https://help.fareharbor.com/hc/en-us/articles/42957480670363-Discount-codes)) | **Absent.** No discount/promo/coupon logic in `src/lib/payments/checkout.ts` or `src/db/orders.ts`; one unrelated comment about a rental "full-set discount" in `src/lib/rentals.ts:147` | Growth-layer gap — cheap to build once checkout supports a second line-item adjustment |
| Gift cards | Sold, redeemed, and managed from the Dashboard, usable on any activity ([Gift card overview](https://help.fareharbor.com/hc/en-us/articles/40897463478555-Gift-card-overview)) | **Absent.** Zero references anywhere in `src` | Real revenue lever (holiday/gifting season) but non-trivial: needs a stored-value ledger, not just a checkout tweak |
| Add-ons / upsells at checkout | Combos (pick-your-own add-ons) and Packages (pre-bundled, up to 3 items booked together) directly in the book flow ([Combos](https://fareharbor.com/blog/maximize-sales-and-customer-satisfaction-introducing-fareharbor-combos/), [Packages](https://fareharbor.com/blog/how-to-turn-your-best-tour-and-activity-offerings-into-high-performing-packages/)) | **Absent as a diver self-serve flow.** `checkout.ts` builds exactly one Stripe line item per trip/course fee; rental *fit* (`src/lib/rentals.ts`) records sizes only, never a price; staff can add line items post-booking (`src/app/shop/[shopSlug]/orders/new/page.tsx`), but a diver can't add a rental/photo package while booking | Meaningful average-order-value gap; rental gear is the obvious first add-on since sizing already exists — just needs a price |
| Self-service reschedule/cancel | Guests can rebook or cancel their own reservation online ([Exceptional Customer Experience](https://fareharbor.com/sell/customer-experience/)) | **Absent.** `cancelBooking` (`src/db/bookings.ts:394`) is only called from staff-side `src/app/shop/[shopSlug]/trips/[id]/actions.ts`; no diver-facing cancel/reschedule route exists off `/ready/[token]` or elsewhere. The automated refund-in-window mechanism ([ADR](../../architecture/decisions/20260721-automated-cancellation-refund.md)) still requires staff to initiate the cancel | Reduces staff phone-tag load; needs care — a diver-triggered cancel still has to hit the same capacity/refund/notification paths staff cancels do, and medical/manifest state must stay consistent |
| Abandoned-cart recovery | Automatic recovery email ~2 hours after checkout abandonment, claimed ~20% recovery rate vs. 2.4% industry average ([Abandoned Cart Recovery](https://fareharbor.com/blog/say-goodbye-to-lost-bookings-with-new-abandoned-cart-recovery-feature/)) | **Tracked but not acted on.** A `checkout_abandoned` analytics event exists (`src/lib/analytics.ts:35-36`) but nothing in `src/lib/notifications/index.ts` sends a recovery email off it | Low-effort, high-leverage — the event already fires, this is "wire an existing seam to an existing signal" |
| Private/group charter booking | Private Events tool: proposals, contracts, deposits, and resource-blocking for buyout-style bookings ([Private Events](https://fareharbor.com/sell/private-events/)) | **Absent.** No private/exclusive/buyout concept; "charter" is used only as a synonym for a scheduled trip (`src/db/seed.ts`, `src/db/schema.ts`). Consistent with the roadmap's existing note that there is no boat/resource entity, only trip seat counts (`roadmap.md` §5) | Real dive-shop use case (buyout charters, bachelor/corporate groups) but overlaps the already-open "no boat entity" roadmap item — solve them together, not separately |
| Reviews / ratings display | TripAdvisor widget + Review Express integration, plus FareHarbor's own post-tour review-request emails ([Top Review Platforms](https://fareharbor.com/blog/top-review-platforms-for-tour-activity-operators/)) | **Absent.** No review/rating UI or post-trip review-request email anywhere in `src/app` or `src/lib/notifications` | Trust-signal gap that compounds with the "new + unproven" objection already flagged in competitive-analysis.md — a review-request email is nearly free to add on top of the existing recap flow |
| Multi-currency | Standard on a global booking platform | **Absent.** `orders.ts:111` hardcodes `const currency = "usd"`; schema columns default to `"usd"` throughout `schema.ts` | Non-issue for the US-first launch; only matters if/when international shops are targeted — don't build ahead of demand |
| Structured data (SEO) on booking pages | Not FareHarbor-specific, but their marketplace pages carry rich snippets | **Partial.** JSON-LD (`FAQPage`/`SoftwareApplication`) exists on marketing pages (`src/app/page.tsx`, `src/app/pricing/page.tsx`) but not on the public schedule/trip pages that are actually the booking surface | Cheap, no-risk SEO win once the embed/standalone-page question above is settled (structured data belongs on whichever URL is canonical) |

## What's *not* a gap, despite the FareHarbor comparison

- **Waitlist** — already shipped, self-join, no staff required (`src/db/waitlist.ts`,
  [shipped.md](../shipped.md), ADR `20260719-trip-waitlist.md`). FareHarbor markets this as a newer
  feature; DiveDay already has it.
- **Multiple bookable product types** — trips and courses are both independently schedulable
  (`src/db/course-templates.ts`), so this isn't a single-product system the way the audit might have
  suggested; the real gap is rentals/gear as a *sellable* line item, captured above under add-ons.
- **Distribution network / OTA listing** — already conceded explicitly and correctly in
  [fareharbor-positioning.md](fareharbor-positioning.md#why-fareharbor-is-a-different-fight); not
  re-litigated here.

## Implications for the queue

None of this is safety-critical, so nothing here should jump ahead of V-02 (field-validate the offline
manifest) or the open portability build items. In rough order of leverage per effort, for whoever next
grooms [roadmap.md](../roadmap.md):

1. **Abandoned-cart recovery email** — the cheapest item on this list; the tracking event already
   exists, only the send-side is missing.
2. **Embeddable schedule/booking widget** — directly answers this audit's trigger; start with a
   chrome-less single-trip embed + "Book Now" button before a full calendar widget.
3. **Rental gear as a priced, diver-selectable add-on at checkout** — reuses the existing rental-fit
   sizing flow, just needs a price and a second Stripe line item.
4. **Post-trip review-request email** — rides the existing recap flow (`/recap/[token]`); compounds
   with the trust-signal objection already tracked in competitive-analysis.md.
5. **Promo/discount codes** and **diver self-service cancel/reschedule** — both need real design work
   (discount-stacking rules; keeping a diver-triggered cancel consistent with capacity/refund/manifest
   state) so they're sequenced after the above, not before.
6. **Gift cards** and **private/group charter booking** — real revenue levers, but each is closer to a
   new subsystem (stored-value ledger; resource/boat modeling) than a slice on top of what exists.
   Private charters should be designed together with the already-open "no boat entity" roadmap item
   (§5), not as a separate effort.
7. **Multi-currency** and **SEO structured data on booking pages** — leave multi-currency until
   international demand is real; structured data is cheap but should wait until the embed question
   (item 2) settles which URL is canonical.
