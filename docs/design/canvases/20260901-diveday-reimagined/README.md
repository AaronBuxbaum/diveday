# DiveDay, reimagined — three directions, and a second page

- **Status:** Shipped (its ADR is Accepted — H-64, 2026-09-01; slices 13a–13j landed 2026-09-01 to 2026-09-02)
- **Date:** 2026-09-01
- **ADR:** [20260901-diveday-reimagined](../../../architecture/decisions/20260901-diveday-reimagined.md)
- **Published:** https://claude.ai/code/artifact/b4b4c1a1-987d-4d98-b754-5beea4814108

The seventh design canvas, and the first that argues a *direction* rather than a surface. The owner's
brief: nothing needs to stay the way it is; people should think "wow" using DiveDay, and a shop
leaving FareHarbor should be easily swayed. Three directions redraw the same four surfaces for the same
shop on the same day so they compare like for like. **Nothing here is normative**; the ADR carries the
decision, and it holds that decision open until one direction is picked.

A second page, added the same day, answers the owner's second brief — research what a dive shop's
identity looks like, and match what FareHarbor offers for embedding — with a fourth direction,
**Harbor**, and the embed system drawn as artboards. See "Page 2" below.

## Artboards

Two pages. On the first, one row per surface, one column per direction; the cover sits above the grid.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the three directions, their axes and tradeoffs, how to read the canvas |
| `TideSystem.dc.html` · `DeckSystem.dc.html` · `ReefSystem.dc.html` | Each direction's system sheet: faces, palette, spacing and elevation, the core components drawn as markup, the three wow moments |
| `TideHome.dc.html` · `DeckHome.dc.html` · `ReefHome.dc.html` | The staff shop home on the morning of the fiction's day, desktop |
| `TideStorefront.dc.html` · `DeckStorefront.dc.html` · `ReefStorefront.dc.html` | The public shop page a diver books from, desktop |
| `TideSwitch.dc.html` · `DeckSwitch.dc.html` · `ReefSwitch.dc.html` | The page a shop reads when it is leaving FareHarbor, desktop |

`Tide.md`, `Deck.md` and `Reef.md` carry each direction's own case in prose: the sentence, the
motivation, the honest tradeoff, the three wow moments, and what it keeps from Clearwater.
`canvas.json` lays the grid out and pins a note at the head of each row.

## Page 2 — their brand, not ours

The research, done 2026-09-01 on public dive-shop websites in Key Largo, agency portfolios that build
for dive shops, logo galleries, and FareHarbor's public plugin listings (nothing on the canvas copies
any of them): dive shops have strong, personal identities — ocean blue with one warm accent,
underwater photography everywhere, a creature for a mark, a wall of badges, navigation by product —
and every "Book Now" button hands the diver to a third-party page that looks nothing like the shop.
FareHarbor's embed catalogue is a button that opens a modal over the shop's site, an inline
availability calendar, an item grid, curated "flows", price sheets, a language override, affiliate
links and QR codes, WordPress shortcodes, Wix inline-or-popup, and a hosted "Sites" website product
sold for about $10,000 a year.

The page draws one answer to both findings: **Harbor**, where DiveDay wears the shop's brand and the
diver never leaves it. `Harbor.md` carries its case. Harbor is an axis rather than a fourth taste —
it composes with Tide, Deck or Reef, which is why the ADR's pick becomes two questions.

| File | What it shows |
| --- | --- |
| `Round2.dc.html` | The page's cover: the research as three abstract brand cards, the handover the button makes today, Harbor in a block, the embed catalogue with what ships and what is proposed |
| `HarborSystem.dc.html` | Harbor's system sheet: the two token layers (owned by the shop, owned by DiveDay), the derivation rule, three shops on one component set, where the brand may never go, the three wow moments |
| `HarborStorefront.dc.html` | `/s/blue-mantis` as the shop's own website: hero, next boat, badge wall, the week ledger, courses, reviews, boats, and DiveDay as a credit line |
| `EmbedLightbox.dc.html` · `EmbedPhone.dc.html` | The shop's own site with the DiveDay booking sheet open over it, desktop and phone, in the shop's colours |
| `EmbedCalendar.dc.html` · `EmbedGrid.dc.html` | The inline calendar on the shop's schedule page; the item grid, the courses list and the one-departure card on its diving page |
| `EmbedGenerator.dc.html` | Settings → Website embed rebuilt as a generator, in DiveDay's current staff look: what to embed, what it shows, how it looks, which platform, the snippet |
| `HarborSwitch.dc.html` | The website half of the leaving-FareHarbor page: today beside DiveDay, the mapping from each FareHarbor embed to its DiveDay equivalent, the price line, the two doors in the decided order |

Every embed but the calendar iframe and the plain button is tagged *Proposed* on the boards, because
that is all the shipped generator emits today (ADR 20260726-schedule-embed).

## The fiction every board holds to

The same one as every canvas since Clearwater — copied here so a reader need not open another README.
**Blue Mantis Divers**, Key Largo (100 Ocean Drive · +1 305 555 0142 · hello@demo.invalid), ★4.3
across 83 reviews, boats *Mantis II* and *Skiff*, online payments connected, default crew Keiko Tanaka
and Sal Moretti; Marcus Webb teaches the courses; Dana Reyes owns the desk. The day is **Thursday,
August 27, 2026**:

- **7:00–10:30 AM · Two-Tank Reef — Molasses & French** · Molasses Reef · Mantis II · $95 · 10 of 12
  booked. Work: Grace Mensah's certification awaits verification, Priya Sharma's waiver has not been
  sent, 3 divers still need rental sizes, Nadia Petrov has no emergency contact on file.
- **1:00–5:00 PM · Wreck Trip — Spiegel Grove** · Mantis II · $145 · 10 of 10, full. Work: no
  divemaster or instructor assigned; Tomás Ferreira has no certification on file for a deep wreck.
- **7:30–11:00 PM · Night Dive — City of Washington** · Skiff · $120 · 3 of 8. Work: 5 spots open with
  no last-minute deal sent.

## What every direction keeps

The name and the bubble mark, the divemaster's voice, the dock test (44px targets, readable in glare,
never colour alone for a status), and the claims policy — nothing on a marketing board that the demo
cannot do today. Each direction argues its own coral budget and says so in its `.md`.

## Known deviations, on purpose left in

The boards are arguments, not the funnel. Two things the pick corrects rather than the canvas:

- **Door order.** [marketing.md](../../../product/marketing.md) decided on 2026-08-22 that the demo
  leads everywhere and the trial follows. Deck's FareHarbor page keeps that order; Tide's and Reef's
  put the trial first. The chosen direction implements the decided order through `FunnelCtas`.
- **Price and trial.** Every board says $99 per location per month and a three-week trial, which
  is what `/pricing` says today; the figure stays single-sourced in `src/lib/marketing.ts` and is
  never restated in code.

## Slices

The pick was made 2026-09-01 (H-64): Reef for the staff app with Geist kept, Harbor for every
diver-facing surface, the embed catalogue as drawn. The ADR's slice table is the sequence; this table
is the record of what has landed. **Five things on the boards are not what ships**: Fraunces (the
owner kept Geist as the only face, so every display moment is Geist at weight and size); the
door order on Tide's and Reef's switching boards (the demo leads); the embed generator's third
look (DiveDay dark — the app has no forced-scheme mechanism, so a widget follows the visitor's
scheme) and its "one course" / "a named set" choices (filed, not half-drawn); the badge wall's
shop-set order (the wall renders in the catalogue's order); and the home's greeting mark (the
bubble trail beside "Good morning" — the ADR sanctions the hand as a departure's mark and in the
three moments, and the greeting is neither). One thing ships that no board drew: the wreck, the
hand's seventh drawing, because Key Largo dives one every week.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 1 — the pick: Reef for the staff app, Geist kept; the ADR Accepted | shipped | `docs/architecture/decisions/20260901-diveday-reimagined.md` | H-64 in `docs/product/human-decisions.md` |
| 2 — the second pick: the diver-facing surfaces go Harbor; the embed catalogue approved | shipped | `docs/architecture/decisions/20260901-diveday-reimagined.md` | H-64 in `docs/product/human-decisions.md` |
| 13a — Reef's tokens for the staff app | shipped | `src/components/ui/card.tsx` | `src/components/ui/card.test.tsx` |
| 13b — the shop's brand: schema, `brand.ts`, the Settings Brand group | shipped | `src/lib/brand.ts` | `src/lib/brand.test.ts` |
| 13c — Harbor's storefront | shipped | `src/components/BrandStyle.tsx` | `src/components/BrandStyle.test.tsx` |
| 13d — the embed catalogue and the generator | shipped | `src/lib/embed-snippets.ts` | `src/lib/embed-snippets.test.ts` |
| 13e — the offer on the marketing pages | shipped | `src/lib/migration-guides.ts` | `src/lib/migration-guides.test.ts` |
| 13f — the drawn site mark | shipped | `src/components/illustration/SiteMark.tsx` | `src/components/illustration/SiteMark.test.tsx` |
| 13g — the water closes over finished work | shipped | `src/app/shop/[shopSlug]/_components/today/StationSettles.tsx` | `src/app/shop/[shopSlug]/_components/today/StationSettles.test.tsx` |
| 13h — the count that fills | shipped | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/HeadCount.tsx` | `src/app/shop/[shopSlug]/trips/[id]/manifest/_components/HeadCount.test.tsx` |
| 13i — the diver's day, drawn | shipped | `src/app/ready/[token]/_components/AfterState.tsx` | `src/app/ready/[token]/_components/AfterState.test.tsx` |
| 13j — the night palette | shipped | `src/app/globals.css` | `src/lib/night-palette.test.ts` |
| the detail pass (2026-09-02) — the sheet's rungs (radius 10/18/28, rows 52, buttons 48/16, the type ladder, the water band), the rest of the hand (turtle, parrotfish, the swell as one component, the night tile, the coral cap), the home's four missing parts (glyph, dial, horizons, "First thing"), Harbor's headings, about line, boats' sentences and brand preview, and the embed catalogue's promises (payment handoff, button contrast, one credit) | shipped | `src/components/illustration/illustration.test.ts` | `src/components/ui/card.test.tsx`, `src/lib/embed-loader.test.ts` |

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard on both pages, `canvas.json`, the title
"DiveDay, reimagined"), check it, and republish to the URL above. The seeded output is build output and is never committed
([design-artifacts.md](../../design-artifacts.md)).
