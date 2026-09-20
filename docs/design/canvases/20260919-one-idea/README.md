# One idea — the app is the day, the boat, or the sea

- **Status:** Live (its ADR is Proposed, pending H-88; drawn 2026-09-19 on the owner's read of the 2026-09-18 canvas's round 2; nothing has shipped from it)
- **Date:** 2026-09-19
- **ADR:** [20260919-one-idea](../../../architecture/decisions/20260919-one-idea.md)
- **Published:** https://claude.ai/artifact/8oUihSuV75uRbj8DrJ9EpU (round 3 first, with rounds 2 and 1 below it for the record; the superseded canvas's own page stays at its URL)
- **Supersedes:** [Nothing to explain](../20260918-nothing-to-explain/README.md) (2026-09-18, rounds 1–2), whose floor and round-2 surface stand and whose three directions and call (H-87) are withdrawn

The sixteenth design canvas, and the third round of the 2026-09-18 brief. The owner's read of round 2,
the same evening: "You're still not thinking big enough. I think the way that our current design looks
in its entirety, top-down, needs complete rethinking." This canvas takes that at its word. Every
canvas before it — Reef, One hand, Clear the deck, and Nothing to explain's two rounds — kept the
app's skeleton (pages of rows under a nav of nouns) and argued about its clothes. An Apple product is
one idea about the thing itself: Weather is the sky, Wallet is the cards, Maps is the map. So the
cover puts **the entire current app on one sheet** (57 distinct surfaces at phone width), names the
test ("name the physical thing the app is"), and the three boards beside it draw **three whole
products**, each built on one physical thing a dive shop already thinks in — **I · Tide**, the app is
the day; **II · Deck**, the app is the boat; **III · Chart**, the app is the sea — on the same fiction,
the same six screens, each with its own home, its own way to reach anything, its own material and its
own thing to tap. There is one call, H-88: which thing. **Nothing here is normative**; the ADR carries
the three ideas as tables, the recommendation and the call, and code obeys the ADR.

## Artboards

One page: the cover on the left, the three ideas in a row beside it, so the same screen can be
compared across the three by scrolling sideways.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the read, the entire current app on one sheet with what it leaves out, the count (99 routes, 21 destinations, 18 settings pages, 15 canvases), the ledger of what every canvas kept and changed, the three ideas as cards, the same morning in three pockets side by side, what every idea deletes and what none touches, the recommendation with the one call, how it lands |
| `Tide.dc.html` | **I · Tide** — the sky at the top is the shop's own hour, the boats sit on the hours they leave, the tide breathes under them, a line for now. The home in a pocket at 6:40 AM and the 7:00 departure at 6:58; the home on a desk with the week beside it; the night roll call at 7:26 PM under a dusk sky; the storefront under the noon sky in the shop's own face; what it deletes, keeps and where it is weakest |
| `Deck.dc.html` | **II · Deck** — each hull an object in its own colour with its seats bow to stern; a seat fills when someone books, turns green when they step aboard, red when they cannot; roll call is tapping seats. The stack in a pocket and Mantis II's page; the shelf on a desk with the week as boats; the night roll call on Skiff; the storefront with the seat you are about to take |
| `Chart.dc.html` | **III · Chart** — the shop's own water, north up: the dock, the rings, the reef line, the sites where they are, today's boats on their tracks. The chart with the day as a sheet over it and Mantis II's voyage; the chart on a desk beside the day; the chartplotter at night; the storefront's "where we go" |

`today-everything.jpg` is 57 distinct surfaces of the running app at `b49abbe` on 2026-09-19 —
every route a signed-in owner or a diver could reach on the demo shop, over four capture passes
between the dev server's restarts (#1882) — captured at 390 wide in light, the first screen of each, tiled ten to
a row with the page's title and path under it, and downsampled. It is evidence, dated like the rest
of the canvas, and is never refreshed. `canvas.json` lays the four boards on one page and pins one
note.

## The fiction every board holds to

The same one as every canvas since Clearwater, so these boards compare with last week's. **Blue
Mantis Divers**, Key Largo (EDT), green `#1d7a5f`, Bricolage Grotesque on its storefront, boats
*Mantis II* (12 seats) and *Skiff* (8), Dana Reyes at the desk, Keiko Tanaka and Sal Moretti as
crew. The day is **Thursday, August 27, 2026, at 6:40 AM**: the 7:00 Two-Tank Reef — Molasses &
French on Mantis II, 10 of 12 booked, 6 here (Ravi Nair, Hannah Liu, Ben Carter, Emma Fischer, Ines
Costa, Nadia Petrov), Grace Mensah's Advanced card awaiting a look and Priya Sharma's waiver not
sent so neither can board yet, Nadia without an emergency contact, Hannah, Ben Carter and Emma
without rental sizes, Hugo Marsh and Ben Okafor not here yet; the 1:00 Wreck Trip — Spiegel Grove,
full, no crew assigned, Tomás Ferreira without a card for a deep wreck; the 7:30 Night Dive — City
of Washington on Skiff, 3 of 8, no last-minute deal sent, Jonas Berg's first dive since 2019. At
the desk: three messages waiting, one review waiting (Lars P.), Priya's $95 at 6:02 not yet
confirmed by Stripe, Dana's unfinished booking of Emmet O'Brien on Friday's 7:00. The week: Friday's
7:00 Morning Two-Tank at 9 of 12 and 8:00 Deep Wreck — the Duane at 1 of 8, Saturday's 11:00 sold
out with two waiting and its 7:30 at 5 of 8, Sunday's 11:30 — Benwood at 3 of 12; 62 of 84 seats
sold. The roll call on Mantis II at 6:58: 9 of 10 aboard, Hugo Marsh not aboard. The night roll
call on Skiff at 7:26 PM: 2 of 3 aboard (Amira Khan, Lars Petersen), Jonas Berg not aboard, Keiko
Tanaka as crew. Every name, number and time is demo-seed fiction. Nothing here is real customer
data.

## What every board holds to

- **The same six screens**, so the three ideas compare by eye: the home in a pocket at 6:40 AM; the
  7:00 departure at 6:58 (two minutes to lines off); the home on a desk at 1280; the night roll call
  on Skiff at 7:26 PM; the storefront in a pocket.
- **Round 2's surface** beneath every idea: the device's own face with Inter then Geist as the
  fallback, one DiveDay blue in two strengths on staff surfaces, red and amber always beside a word,
  green only as the aboard fill, two concentric radii, capsules, an iPhone around every pocket frame,
  black at night. The three ideas differ in what the page *is*, not in what it is wearing.
- **The storefront keeps its face**: Harbor's Bricolage Grotesque on the shop's name and the shop's
  own colour on the one filled control, over the idea's own structure.
- **Safety is drawn exactly as it is**: a blocked diver is red beside a word on every board, the roll
  call is one tap per name, the count on the surface is the same picture as boarding.
- **Nothing is invented that the product cannot compute.** The sun, the tides, the seas and the wind
  come from `src/lib/sun-moon.ts`, `departure-tides.ts` and `marine-forecast.ts`; a boat's seats from
  `boats.capacity`; a site's place from `dive_sites.forecast_latitude/longitude`. Each board's foot
  names what each idea would add (one column for Deck, a coastline decision for Chart).

## Known deviations, on purpose left in

- **The chart's coastline is a stylised placeholder.** The land on Chart's boards is a soft shape
  drawn to make the picture read; the product holds no coastline. The ADR ships v1 without one (the
  dock, the rings, the sites) and names the follow-up.
- **The dusk and dawn skies are gradients chosen by eye.** The rule the ADR states is one flat
  gradient per hour computed from the almanac; the exact stops are the implementer's.
- **Deck's hull colours are invented** (a blue for Mantis II, a teal for Skiff). The column that would
  hold them does not exist yet and is named in the ADR.
- **Every fact on the boards is the fiction's**, including the tide turns, the moon and the seas.

## Slices

Nothing has shipped from this canvas. Round 2's surface rows (22a, 22b, 22i on the superseded canvas)
land first under any pick, because every idea is drawn on them; everything below waits on H-88. When
a slice lands, the component that must not drift names the ADR in its doc comment, a test pins the
rule, and this table moves.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 23i — the day itself: `sky-scheme.ts`, `day-strip.ts`, `SkyBand`, `DayStrip` — geometry and gradients, prose-free, gating nothing | shipped | `src/lib/day-strip.ts` | `src/lib/day-strip.test.ts`, `src/lib/sky-scheme.test.ts`, `src/components/day/*.test.tsx` |
| 23a — the picked idea's home: `/shop/[shopSlug]` becomes the day (I), the stack (II) or the chart (III), on round 2's surface; the Today spine's actions become the idea's own things (hours, seats, tracks) | in progress | `src/app/shop/[shopSlug]/_components/day/DayHeader.tsx` — the day's top; the spine's actions move with 23c | `e2e/day-spine.spec.ts` "the day stands at the top of its own page" |
| 23b — the shell: the nav of nouns leaves — no tabs, no More, no dock; a date, a search and the shop's name (I), the shop's card (II), the dock (III); `staff-destinations.ts` regrouped into the idea's places; ⌘K stays as the search | shipped | `src/lib/staff-destinations.ts` | `src/lib/staff-destinations.test.ts`, `src/components/ShopPlaceNav.test.tsx`, `e2e/staff-nav.spec.ts` |
| 23c — the departure: the hour page with the strip (I), the hull with its seats (II), the voyage on the chart (III); the four trip tabs one page; the roll call's one tap untouched beneath | in progress | `src/app/shop/[shopSlug]/trips/[id]/_components/VoyageHeader.tsx` — the hour over its own sky with the voyage drawn, above `_components/TripHull.tsx`'s boat and its roster; **the four tabs are what is left**, and they wait on ADR 20260919-one-idea §3b, which is the list standing between a hull and a manifest | `src/lib/hull.test.ts` (the canvas's own outlines, verbatim), `src/app/shop/[shopSlug]/trips/[id]/_components/TripHull.test.tsx`, `e2e/trip-hull.spec.ts` |
| 23d — the storefront's front page on the idea, in Harbor's face and the shop's colour: the day and the week (I), the boat you are about to book (II), where we go (III) | shipped | `src/app/s/[shopSlug]/_components/ShopfrontHero.tsx` | `src/app/s/[shopSlug]/_components/ShopfrontHero.test.tsx`, the `storefront-sky` capture in `e2e/visual.spec.ts` |
| 23e — the diver, the counter and the walk-in reached through the idea: search and a sheet over the home; the person's record unchanged inside it | open | — | — |
| 23f — the week, the requests and the season on the idea: the Board becomes the week; a request is a ghost day (I), a boat to put out (II), a track to add (III) | open | — | — |
| 23g — the rest, one family per session: courses, gear, money, reviews, staffing, and Settings behind the shop's name | open | — | — |
| 23h — night and glare on the idea: by the hour (I) or by the device (II, III); glare as the crew's word in the roll call's bar; the black-on-white twin held by a test | open | — | — |

## Working on it

The boards are plain HTML with the shared stylesheet blocks pasted between marker comments
(`/* kit:start */`, `/* app3:start */`, `/* tide:start */`, `/* deck:start */`, `/* chart:start */`,
`/* cover3:start */`); the day strips, the hulls and the charts are SVG generated from a few numbers
(the sunrise, the tide turns, a boat's seats and their states, a site's place) so the hours and the
counts are true. Edit a `.dc.html` directly, or regenerate all four from the same blocks; keep every
board under the 400 KB cap and every image downsampled.
