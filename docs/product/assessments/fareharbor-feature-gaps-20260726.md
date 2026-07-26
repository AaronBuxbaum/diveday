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
| Promo / discount codes | Operator-configured codes at checkout ([Discount codes](https://help.fareharbor.com/hc/en-us/articles/42957480670363-Discount-codes)) | **Absent.** No discount/promo/coupon logic in `src/lib/payments/checkout.ts` or `src/db/orders.ts`; one unrelated comment about a rental "full-set discount" in `src/lib/rentals.ts:147` | Growth-layer gap — cheap to build once checkout supports a second line-item adjustment |
| Gift cards | Sold, redeemed, and managed from the Dashboard, usable on any activity ([Gift card overview](https://help.fareharbor.com/hc/en-us/articles/40897463478555-Gift-card-overview)) | **Absent.** Zero references anywhere in `src` | Real revenue lever (holiday/gifting season) but non-trivial: needs a stored-value ledger, not just a checkout tweak |
| Add-ons / upsells at checkout | Combos (pick-your-own add-ons) and Packages (pre-bundled, up to 3 items booked together) directly in the book flow ([Combos](https://fareharbor.com/blog/maximize-sales-and-customer-satisfaction-introducing-fareharbor-combos/), [Packages](https://fareharbor.com/blog/how-to-turn-your-best-tour-and-activity-offerings-into-high-performing-packages/)) | **Absent as a diver self-serve flow, but the pricing groundwork already exists.** `checkout.ts` builds exactly one Stripe line item per trip/course fee. Rental *fit* is further along than "sizes only": `src/lib/rentals.ts` defines `RentalPricing`/`quoteRentalFit`, Settings → Rental prices persists the shop's per-item prices, and `RentalFitForm` shows the diver the resulting quote — checkout just never charges it. Staff can add line items post-booking (`src/app/shop/[shopSlug]/orders/new/page.tsx`), but a diver can't add the already-quoted rental total (or anything else) while booking | Smaller lift than it looks — the missing piece is payment integration and price/order snapshotting at checkout time, not building rental pricing from scratch |
| Self-service reschedule/cancel | Guests can rebook or cancel their own reservation online ([Exceptional Customer Experience](https://fareharbor.com/sell/customer-experience/)) | **Absent.** `cancelBooking` (`src/db/bookings.ts:394`) is only called from staff-side `src/app/shop/[shopSlug]/trips/[id]/actions.ts`; no diver-facing cancel/reschedule route exists off `/ready/[token]` or elsewhere. The automated refund-in-window mechanism ([ADR](../../architecture/decisions/20260721-automated-cancellation-refund.md)) still requires staff to initiate the cancel | **Safety-critical, not just growth-layer** — this is a diver-triggered mutation of manifest/roster state, and AGENTS.md's hard rules put manifest and medical-flag consistency in the same bucket as roll call and cert gating: boring code, failure-path/adversarial tests, and a `dive-domain-expert` review (plus `security-reviewer` for the new diver-triggered mutation surface itself), not a routine growth-layer add |
| Abandoned-cart recovery | Automatic recovery email ~2 hours after checkout abandonment, claimed ~20% recovery rate vs. 2.4% industry average ([Abandoned Cart Recovery](https://fareharbor.com/blog/say-goodbye-to-lost-bookings-with-new-abandoned-cart-recovery-feature/)) | **Less built than the analytics layer suggests, but the durable pieces already exist elsewhere.** `checkout_abandoned` is only a type-level `AnalyticsEvent` entry (`src/lib/analytics.ts:34-38`) with no production call site and no durable/recipient data — but every real checkout attempt already writes a durable `booking_checkouts` row (`status: "pending"`, `checkoutUrl`, `expiresAt`, `src/db/schema.ts:897-933`) linked via `booking_checkout_bookings` to the bookings (and thus the person/email) it covers (`src/db/checkouts.ts:145-169`). Nothing in `src/lib/notifications/index.ts` sends a recovery email off a stale pending row | Smaller scope than it first looked: the durable checkout record and recipient resolution already exist; what's missing is querying for stale `pending` sessions past an age threshold and scheduling/deduping the send — not building detection or recipient lookup from scratch |
| Private/group charter booking | Private Events tool: proposals, contracts, deposits, and resource-blocking for buyout-style bookings ([Private Events](https://fareharbor.com/sell/private-events/)) | **Party booking already exists; the private/buyout workflow is the actual gap.** The public form already books a party of up to six atomically (`createBookingParty`) with one shared checkout (`startBookingCheckout`, `src/app/shop/[shopSlug]/schedule/[id]/actions.ts:115-151`, `src/db/checkouts.test.ts:129-148`) — so "group booking" is shipped. What FareHarbor's Private Events adds and DiveDay doesn't have is the buyout-a-whole-trip proposal/contract/resource-blocking workflow; "charter" elsewhere in the code is just a synonym for a scheduled trip (`src/db/seed.ts`, `src/db/schema.ts`), consistent with the roadmap's existing note that there is no boat/resource entity (`roadmap.md` §5) | Real dive-shop use case (buyout charters, bachelor/corporate groups), but scope it as the buyout workflow on top of shipped party booking, not a rebuild — and it overlaps the already-open "no boat entity" roadmap item, so solve them together |
| Reviews / ratings display | TripAdvisor widget + Review Express integration, plus FareHarbor's own post-tour review-request emails ([Top Review Platforms](https://fareharbor.com/blog/top-review-platforms-for-tour-activity-operators/)) | **Absent, and there's no destination for a review link yet either.** No review/rating UI or post-trip review-request email anywhere in `src/app` or `src/lib/notifications`; `tripRecapEmail` only accepts the DiveDay recap URL, and nothing in the shop schema/settings holds a Google/TripAdvisor/other review-platform link to send a diver to | A review-request email riding the existing recap flow is real, but it isn't just "add a send" — it needs a shop-configurable review-link destination (or an internal rating surface) before there's anywhere for the email to point |
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
the offline manifest) or the open portability build items — **with one exception**: self-service
cancel/reschedule mutates manifest and payment/refund state through a new diver-triggered surface, which
AGENTS.md's hard rules place in the same safety-critical bucket as roll call and cert gating
(`dive-domain-expert` review, plus `security-reviewer` for the new mutation surface itself) — sequence
and review it accordingly, not as routine growth work. In rough order of leverage per effort otherwise,
for whoever next grooms [roadmap.md](../roadmap.md):

1. **Abandoned-cart recovery email** — cheaper than it first looked: the durable `booking_checkouts`
   row and its linked booking/person already exist for every real checkout attempt
   (`src/db/schema.ts:897-933`, `src/db/checkouts.ts:145-169`); what's left is querying stale `pending`
   sessions past an age threshold and scheduling/deduping the send.
2. **Embeddable schedule/booking widget** — directly answers this audit's trigger; start with a
   compact single-trip embed + "Book Now" button before a full calendar widget — the anonymous pages
   are already close to chrome-free, so this is mostly a snippet generator and a minimal embed shell,
   not chrome removal.
3. **Rental gear as a priced, diver-selectable add-on at checkout** — the pricing already exists
   (`RentalPricing`/`quoteRentalFit`, shop-configured prices, the diver-facing quote in
   `RentalFitForm`); what's missing is charging that quote at checkout and snapshotting it on the
   order, not building a price from scratch.
4. **Post-trip review-request email** — rides the existing recap flow (`/recap/[token]`), but first
   needs a shop-configurable review-link destination (no Google/TripAdvisor/etc. field exists yet);
   compounds with the trust-signal objection already tracked in competitive-analysis.md.
5. **Promo/discount codes** need real design work (discount-stacking rules), so it's sequenced after
   the above.
6. **Diver self-service cancel/reschedule** — see the safety-critical note above; sequence with its
   required reviews in mind, not purely by "growth leverage."
7. **Gift cards** and **the private/buyout charter workflow** — real revenue levers, but each is
   closer to a new subsystem (stored-value ledger; resource/boat modeling + proposal/contract flow on
   top of the party booking that already ships) than a slice on top of what exists. Private charters
   should be designed together with the already-open "no boat entity" roadmap item (§5), not as a
   separate effort.
8. **Multi-currency** and **SEO structured data on booking pages** — leave multi-currency until
   international demand is real; structured data is cheap but should wait until the embed question
   (item 2) settles which URL is canonical.
