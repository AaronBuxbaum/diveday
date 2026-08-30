# Clearwater — the surface language, drawn

- **Status:** Shipped (its ADR is Accepted — this canvas is the dated argument, superseded rather than freshened)
- **Date:** 2026-08-27
- **ADR:** [20260827-clearwater-surface-language](../../../architecture/decisions/20260827-clearwater-surface-language.md)
- **Published:** https://claude.ai/code/artifact/056c99fa-49f8-4939-aacd-b96e6fd771f8

The second design canvas in this repo, following the conventions
[design-artifacts.md](../../design-artifacts.md) set with the first
([the departure canvas](../20260827-the-departure-is-two-working-surfaces/README.md), which owns
the trip and manifest surfaces — deliberately out of scope here). **Nothing here is normative**;
the ADR carries the decisions, these are the pictures drawn to argue them.

## Artboards

**Page 1 — The language**

| File | What it shows |
| --- | --- |
| `System.dc.html` | The Clearwater language: the stance, the two grouped anatomies (and the retired card stack), the closed type ramp, tone discipline, row anatomy, the one badge, the chrome spec, the elevation ladder |

**Page 2 — The staff app**

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The home as the day's spine, morning reading, desktop: three stations carrying their own work, the desk group, collapsed horizons |
| `Evening.dc.html` | The same spine that evening: stations closed with their head-count results, leftovers, the one closing act |
| `TodayPhone.dc.html` | The home on a 390px phone with the staff dock |
| `Board.dc.html` | The schedule board as a week: seven columns, a spanning three-day course, past days dimmed, today marked |
| `Orders.dc.html` | Orders as a day ledger: group headers own the date and subtotal, toolbar filters, imported history as one disclosure |
| `Settings.dc.html` | Settings as rail and pane: the whole map on the left, the selected destination as inset groups on the right |
| `Counter.dc.html` | The counter as a boarding instrument at portrait-tablet width: the count leads, blocked rows carry their fix, settled rows sink |
| `QuietDay.dc.html` | The home on a day with no departures: the whole-page collapse — a heading, one sentence, one act, and the dock at four destinations plus More after the fold |

**Page 3 — The shopfront**

| File | What it shows |
| --- | --- |
| `Storefront.dc.html` | The public schedule as a shopfront, desktop: identity hero, the next boat as a bookable object, the week at one line per row, courses and reviews shelves |
| `StorefrontPhone.dc.html` | The shopfront on a 390px phone |

`canvas.json` places them on the three pages and sets the launch view.

## The fiction every board holds to

One shop, one day, one week. **Blue Mantis Divers**, Key Largo (100 Ocean Drive · +1 305 555 0142
· hello@demo.invalid), ★4.3 across 83 reviews, boats *Mantis II* and *Skiff*, online payments connected, default crew Keiko
Tanaka and Sal Moretti; Marcus Webb teaches the courses; Dana Reyes owns the desk. The day is **Thursday, August 27, 2026**:

- **7:00–10:30 AM · Two-Tank Reef — Molasses & French** · Molasses Reef · Mantis II · $95 ·
  10 of 12 booked. Work: Grace Mensah's certification awaits verification (blocks boarding), Priya
  Sharma's waiver has not been sent (blocks boarding at the 6:15 reading; she signs on paper at
  the counter at 6:41 AM, recorded by Keiko, and boards), 3 divers still need rental sizes, Nadia
  Petrov has no emergency contact on file. At the counter by 6:12 AM, seven of its ten are checked
  in (Ines Costa, June Park, Lena Fischer, Marisol Vega, Omar Haddad, Sam Whitfield, Tom Okafor).
- **1:00–5:00 PM · Wreck Trip — Spiegel Grove** · Mantis II · $145 · 10 of 10, full. Work: no
  divemaster or instructor assigned; Tomás Ferreira has no certification on file for a deep wreck.
- **7:30–11:00 PM · Night Dive — City of Washington** · Skiff · $120 · 3 of 8. Work: 5 spots open
  with no last-minute deal sent.

By 11:25 PM all three boats are home — 23 out, 23 back (10 by 10:26 AM, 10 by 4:41 PM, 3 by
10:58 PM); the morning recap is sent, the afternoon's is ready; Lena Fischer's paper signature —
recorded Wednesday, still not sealed — and one waiting review carry to tomorrow. The week (Mon Aug 24 – Sun Aug 30): Mon 11:30 AM Benwood & Elbow (sailed,
9 of 12) · Tue 2:00 PM Discover Scuba (sailed, 2 of 4) · Wed 7:00 AM Molasses & French (sailed, 12
of 12) · Thu as above · Fri 7:00 AM Morning Two-Tank — Molasses Reef ($95, 8 of 12) and
8:00 AM Deep Wreck Charter — the Duane on EANx ($195, 1 of 8) · Sat 11:00 AM Two-Tank — French
Reef ($95, 8 of 10) · Sun 11:30 AM Two-Tank Reef — Christ of the Abyss (0 of 12, no price set on
the staff board, so the public page shows no price) · **Open Water Diver — three-day course** spanning Fri–Sun ($595, 4 of 5). Orders: today
$148.00 (Amara Osei, counter sale), $120.00 open (Diego Alvarez, night dive), $144.75 (Kenji
Watanabe); Wednesday's eight total $916.43 (Bjorn Aasen, Marisol Vega, Priscilla Adeyemi, Lars
Petersen $41.93, Yara Halabi, Sofia Marchetti, Dominic Rossi at $139.75 each; June Park's nitrox
fills $36.00); Tuesday's one is Felix Grant's open $340.00 course balance. Review quotes are the
seed's own (Grace H.'s turtle, Lars P.'s unhurried briefing). Tuesday, September 1 has no departures — the quiet-day board — and the next departure on the board after it is Saturday, September 5's 7:00 AM Morning Two-Tank — Molasses Reef (2 of 12 booked).

Every name, number and time here is demo-seed fiction. Nothing in this directory is real customer
data, and nothing in a future canvas may be either.

## Slices

Which surfaces this canvas still speaks for. **A canvas has authority over a surface only while
that surface's slice is `open`** — once a slice ships, the shipped code is the design for it and
anything here that disagrees is stale ([design-artifacts.md](../../design-artifacts.md)). The slice
bodies, with their pins and owner-call dependencies, are in
[roadmap.md](../../../product/features/roadmap.md#6-clearwater--the-surface-language-design-complete).

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 6a — the language mechanics | shipped | `src/components/ui/ledger.tsx` | `src/components/ui/ledger.test.tsx` |
| 6b — one chrome spec | shipped | `src/components/chrome/ChromeBar.tsx` | `src/components/chrome/chrome.test.ts`, `src/components/PublicShopNav.test.tsx`, `scripts/check-critical-text.mjs`, `e2e/schedule-builder.spec.ts` |
| 6c — the home as the day's spine | shipped | `src/app/shop/[shopSlug]/_components/today/DaySpine.tsx` | `src/app/shop/[shopSlug]/_components/today/DaySpine.test.tsx` |
| 6d — the home's evening reading and the fold (H-62) | shipped | `src/app/shop/[shopSlug]/_components/today/ClosingStation.tsx` | `src/app/shop/[shopSlug]/_components/today/DaySpine.test.tsx` → “the evening reading”; `src/lib/closeout.test.ts` → “assembleEveningClose”; `src/lib/staff-destinations.test.ts` → “has no Close-out destination at all”; `e2e/day-close.spec.ts`. Its other pieces: the closing block (`_components/today/ClosingBlock.tsx`), the pure assembly (`assembleEveningClose` in `src/lib/closeout.ts`), the 308 (`close-out/route.ts`), and the evening's acts (`src/app/shop/[shopSlug]/actions.ts`) |
| 6e — the week board | shipped | `src/app/shop/[shopSlug]/schedule/board/_components/WeekBoard.tsx` | `ScheduleBuilder.test.tsx` → “ScheduleBuilder week board”; `src/db/trips-queries.test.ts` → “the week board”; `src/lib/week-board.test.ts`; `e2e/schedule-builder.spec.ts` → “the board is the day stream below 1280px and the week from 1280 up”. Its reader is `weekBoard()` in `src/db/trips-queries.ts`; the `?week=` grammar is `src/lib/week-board.ts` |
| 6f — the orders day ledger | shipped | `src/app/shop/[shopSlug]/orders/_components/OrdersLedger.tsx` | `src/app/shop/[shopSlug]/orders/_components/OrdersLedger.test.tsx`; `src/app/shop/[shopSlug]/orders/page.test.tsx` → “the day ledger”; `src/db/orders.test.ts` → “pagedOrdersByDay”; `e2e/orders-demo.spec.ts` → “no row repeats its day group's date”. Its reader is `pagedOrdersByDay()` in `src/db/orders.ts`; the toolbar is `_components/OrdersToolbar.tsx` |
| 6g — settings rail and pane | shipped | `src/app/shop/[shopSlug]/settings/_components/SettingsRail.tsx` | `src/app/shop/[shopSlug]/settings/_components/SettingsRail.test.tsx` |
| 6h — the counter instrument | shipped | `src/app/shop/[shopSlug]/check-in/_components/CounterQueueRow.tsx` | `src/app/shop/[shopSlug]/check-in/_components/CounterQueueRow.test.tsx` |
| 6i — the storefront | shipped | `src/app/s/[shopSlug]/_components/WeekLedger.tsx` | `src/app/s/[shopSlug]/_components/WeekLedger.test.tsx` |

6h's other pieces: the instrument itself (`_components/CounterInstrument.tsx`, pinned by
`CounterInstrument.test.tsx` — the earned line renders only at `here === expected`, and never a
second accent beside it), the settled group (`_components/CounterQueue.tsx` /
`CounterQueue.test.tsx`), the segmented departure chips (`_components/DepartureChips.tsx` /
`DepartureChips.test.tsx`), and the URL-carried focus with its evening default
(`check-in/focus.ts` / `focus.test.ts`). Two facts joined the queue reader for it —
`missingEmergencyContact` and a batched `firstVisit` over merged native + imported history — pinned
in `src/db/check-in.test.ts`. Not built: the settled rows carry no check-in **time**, because the
reader holds none and this slice's contract added no third field for one; the drawn mark and the
name are what a settled row says.

6i's other pieces: the identity band (`_components/ShopfrontHero.tsx`, pinned by
`ShopfrontHero.test.tsx` — it renders only what the shop authored, and day zero is a name and
nothing else), the next boat as the page's one card and one primary
(`_components/NextBoatCard.tsx` / `NextBoatCard.test.tsx`), the courses shelf
(`_components/CoursesShelf.tsx` / `CoursesShelf.test.tsx`) with its drawn-swell stand-in for a
course with no photo (`src/components/CourseWavePlaceholder.tsx` — the SPEC named no path for it),
the reviews shelf and the archive's ledger rows (`src/components/ShopReviews.tsx` /
`ShopReviews.test.tsx`), and the accent star fill (`src/components/StarRating.tsx` /
`StarRating.test.tsx`, whose default keeps staff on amber). `pinnedNextDeparture` became
`nextBookableDeparture` in `src/lib/trips.ts`: the pin used to stand down whenever the week's own
first row already had room, and decision 8 makes the next boat the page's subject instead — so the
card always renders and the week keeps its row. Two deliberate departures from the SPEC, both
argued in the pull request: the hero carries **no contact line** (the footer has carried phone,
email and address once per page since issue #777, and the artboard's own footer agrees), and the
reviews shelf **does not restate the aggregate** the hero now owns.

6a also landed `src/components/ui/SettledCheck.tsx` (pinned by `SettledCheck.test.tsx`) and the
flat-at-rest change to `src/components/ui/card.tsx` (pinned by `card.test.tsx`, which now fails the
build on any class string in `src/` wearing `rounded-2xl` and `shadow-sm` together, so the tree
cannot drift back to two elevations on one page). The table's "Lands in" column names one file per
slice.

**The label sweep.** `GroupLabel` and `groupLabelClass` now own the small-caps group-label
spelling across the designed staff, public, course and marketing surfaces. The shared helper carries
the ink as well as the typography, so muted, primary, success and warning headings do not drift back
to hand-rolled tracking. Distinct grammars remain deliberate: the 0.18em public/earned eyebrow, the
calendar's weekday/month header, shop initials, and the compact offline-manifest specimen are not
group labels and stay with their own components.

## Implementing a slice

Load the [`design-implementation`](../../../../.claude/skills/design-implementation/SKILL.md) skill
first — it carries the read order (ADR, roadmap, this table, **current code**, the SPEC's slice
section, artboards last) and the four ship-time obligations. The prompt below is self-contained for a session with none of this
context; replace the slice id.

```
Implement slice 6a of the DiveDay Clearwater surface-language redesign.

Start by loading the `design-implementation` skill, then read, in this order:
  1. docs/architecture/decisions/20260827-clearwater-surface-language.md — normative
  2. the slice's entry in docs/product/features/roadmap.md (section 6)
  3. the slice table in docs/design/canvases/20260827-clearwater-surface-language/README.md
  4. the code for every surface the slice touches, as it exists today
  5. the slice's section of SPEC.md in that canvas directory — journeys, acceptance tests,
     interface contracts; below the ADR, above the artboards
  6. the artboards, last — they argue, they do not decide

Non-negotiable, from the ADR:
  - Shipped code outranks the canvas; the ADR outranks both. The trip/manifest surfaces belong to
    ADR 20260827-the-departure-is-two-working-surfaces, not to this one.
  - Elevation is earned: resting panels are flat; shadows belong to what floats.
  - A shared fact belongs to the group header, never repeated down rows at equal weight.
  - Badge is the only pill; a count is quiet text; figures are tabular.
  - Every colour-carried state also carries a word. Drawn SVG, never emoji, on anything new.
  - No new tokens; hairlines are --border; tints are the existing opaque --*-tint tokens.
  - Both owner calls are decided (H-62, H-63, 2026-08-27): 6d removes the /close-out route in the
    same change that ships the evening reading, and 6e's week grid renders at xl (1280px) and up
    only.

Build it to this repo's standards — semantic tokens, the form/button/card primitives, copy in every
locale's message bundle, the clock and timezone rules, a `loading.tsx` and `instant = true`. Then
close the loop in the same PR: the component names the ADR in its doc comment, a test pins the rule
(never a pixel snapshot), the canvas's slice table is updated, and the roadmap slice moves to
shipped.md when it lands.

Verify before calling it done: `pnpm check` green, screenshots in light and dark at phone and
desktop (tablet for the counter), the design-review skill's pass, e2e and visual coverage for the
surface, and the reviews the hard rules require (dive-domain-expert for the counter,
conversion-reviewer for the storefront). Open a PR and account for every visual diff.
```

## Working on it

These are plain HTML files with inline styles: open one in a browser to see that board on its own.
To rebuild the published canvas from them, use the `/design` skill's helper — seed the artboards
plus `canvas.json` into a fresh payload, `--check` it, and publish to the **same URL** above so the
link in the ADR keeps working.
