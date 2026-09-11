# Clear the deck — six ways to make DiveDay smaller

- **Status:** Live (its ADR is Proposed, pending H-73; round 2 drawn 2026-09-11 on the owner's read of round 1; nothing has shipped from it)
- **Date:** 2026-09-11
- **ADR:** [20260911-clear-the-deck](../../../architecture/decisions/20260911-clear-the-deck.md)
- **Published:** https://claude.ai/code/artifact/d79e2f2e-a6b7-4692-8f32-c67dc5651bb9

The fourteenth design canvas. The owner's brief on 2026-09-11: the design system is ugly and has
far too many controls and external-facing features; rethink the visual presentation; give at least
five concepts that consolidate concepts and make it clean and simple. It follows
[One hand](../20260908-one-hand/README.md), whose four rounds over three days each added — five
levers, eight more, seven possibilities, all seven shipped on 09-10 — while its floor of deletions
(20a–20e) never landed. This canvas answers with **a count** of what is there at `748021f`, read
from the tree and from captures of the running demo shop; **a floor** every concept shares, which
deletes kinds of thing rather than spellings; and **six concepts** that each consolidate along a
different axis — by noun, by time, by place, by question, by default, by face — every one redrawing
the shop home for the same shop on the same morning, at desktop and at 390, so they compare like for
like. **Nothing here is normative**; the ADR carries the floor and the six, the pick is the owner's
(H-73), and code obeys the ADR. A second page, drawn the same day on the owner's read of the first,
redraws the surface itself — see "Round 2" below.

## Artboards

Two pages. On the first, round 1: the cover on top, the six concepts beneath it in two rows of three.
On the second, round 2: its cover, then the five surfaces in a row.

| File | What it shows |
| --- | --- |
| `Main.dc.html` | The cover: the diagnosis in one paragraph, the count at HEAD, three captures of today (the home, the whole storefront, Settings on a phone), the floor with its calls, the six concepts, the side-by-side table, how they combine and the recommendation, the owner's four calls, what no concept changes, how to read the canvas |
| `ThreeWords.dc.html` | **1 · Three words** (by noun) — the staff app is Day, People, Shop; the home as one list in one grammar under three words; the three words as the phone's dock |
| `TheWeek.dc.html` | **2 · The week** (by time) — the calendar as the only list: departures, requests, waivers, orders, logs and service dates as marks on a seven-column week; one day at a time on the phone |
| `AshoreAboard.dc.html` | **3 · Ashore and aboard** (by place) — the desk as a dense ledger at 14px/40px with a five-word rail; the boat as a phone with one boat on it at 20px/64px, black on white, no chrome |
| `Ask.dc.html` | **4 · Ask** (by question) — one field over the day's answers; the same field with "gra" and "sat" typed, answering in the row grammar; the field under the thumb at 390 |
| `TheCard.dc.html` | **5 · The shop's card** (by default) — the whole of Settings as one card of nine facts and twelve decided sentences; where the 43 rows and 12 pages went; what leaves the surfaces |
| `OneFace.dc.html` | **6 · One face** (by face) — the storefront in the shop's brand with the staff strip and the layer of ink under every public row; the boat and the till kept apart |

### Round 2 — Reef, rethought

The owner's read of round 1, 2026-09-11: "I like these ideas, but I think we need to go farther. I
think our Reef concept needs to be rethought since I'm now finding it overbearing and ugly." So the
second page leaves the six concepts where they are (the shape is still call a) and redraws the
surface: a count of the decorative layers on one screen of the home at HEAD (ten devices, five hues
and three washes, four radii, two elevations, nine type rungs), a surface floor every candidate
shares (two hues and red, one radius, no elevation at rest, one structural device, type as the
hierarchy, nothing drawn), and five surfaces that could replace Reef, each a different
temperature, density, structure and face, each drawn on the same home — round 1's recommended
shape, Three words with Ask as its search — and on the counter at 390.

| File | What it shows |
| --- | --- |
| `Round2.dc.html` | The page's cover: the owner's read, why Reef reads as overbearing (the layers counted on one screen), the surface floor, the five surfaces, the same row in five hands beside today's, the side-by-side table, how they combine and the recommendation, the owner's round-2 calls (e)–(h) |
| `Salt.dc.html` | **I · Salt** — white, black, one hairline, the shop's colour on the current word and the verb; Instrument Sans; radius 0 |
| `Air.dc.html` | **II · Air** — a warm-neutral white with no lines; space as the structure, a soft fill under a finger; Figtree; radius 12 |
| `Headline.dc.html` | **III · Headline** — four sizes, two colours, no grey; the boats in the shop's colour at 28px; Schibsted Grotesk; radius 0 |
| `TheirInk.dc.html` | **IV · Their ink** — the shop's colour as the ink in four strengths, its face on the titles, DiveDay's palette gone; Public Sans; radius 6; three shops on one system, with the fallback |
| `Slate.dc.html` | **V · Slate** — a cool grey ground, one white sheet, hairlines, 44px rows, a face cut for low vision; Atkinson Hyperlegible; radius 4 |

Every round-2 board is drawn on the deletions round 1's floor proposes and shows nothing of Reef on
a staff surface, which is call (b) drawn rather than assumed; if the owner keeps the decoration the
boards are not redrawn.

`today-home.jpg`, `today-storefront.jpg` and `today-settings.jpg` are the three captures round 1's
cover reads, taken from `pnpm dev` on 2026-09-11 with `scripts/screenshot.mjs` (the demo shop, light, 1280
and 390) and downsampled. They are evidence, dated like the rest of the canvas, and are never
refreshed. `canvas.json` lays the thirteen boards out on two pages, pins four notes, and opens on round 2.

## The fiction every board holds to

The same one as every canvas since Clearwater. **Blue Mantis Divers**, Key Largo (EDT), green
`#1d7a5f`, Bricolage Grotesque on its storefront, boats *Mantis II* (12 seats, slip 14 at Marina Del
Mar) and *Skiff* (8), Dana Reyes at the desk, Keiko Tanaka and Sal Moretti as crew, Marcus Webb
teaching the courses. The day is **Thursday, August 27, 2026, at 6:40 AM**: the 7:00 Two-Tank Reef —
Molasses & French on Mantis II, 10 of 12 booked and 6 of 10 here — Ravi Nair, Hannah Liu, Ben
Carter, Emma Fischer, Ines Costa and Nadia Petrov checked in; Hugo Marsh and Ben Okafor not yet at
the counter; Grace Mensah's Advanced card awaiting a look and Priya Sharma's waiver not sent, so
neither can board yet; Nadia without an emergency contact; Hannah, Ben Carter and Emma without
rental sizes; Diego Alvarez about to walk in; the 1:00 Wreck Trip — Spiegel Grove, full, with
no crew assigned and Tomás Ferreira without a card for a deep wreck; the 7:30 Night Dive — City of
Washington on Skiff, 3 of 8, no last-minute deal sent, Jonas Berg's first dive since 2019. At the
desk: three messages waiting, one review waiting (Lars P., from the Duane on Saturday, August 22), Priya's $95 at 6:02 not yet confirmed by
Stripe, and Dana's unfinished booking of Emmet O'Brien on Friday's 7:00. The week around it: the
sailed and logged boats on Monday to Wednesday (23 divers and 2 boats on Wednesday), Friday's 7:00
Morning Two-Tank at 9 of 12 and 8:00 Deep Wreck — the Duane at 1 of 8, Saturday's 11:00 Two-Tank —
French Reef sold out with two waiting and its 7:30 Night Dive at 5 of 8, Sunday's 11:30 Two-Tank — Benwood at 3 of 12, Reg #4 due for
service on Monday, and the month at $41,180 with two open orders. Every name, number and time is
demo-seed fiction. Nothing here is real customer data.

## What every board keeps

The name and the mark; Harbor on every diver-facing page (concept 6 makes it everything, never
less); Geist as the only face on a staff surface (round 1; every round-2 surface names its own face, which is call f); the dock test (44px targets, 16px critical text,
AA, never colour alone — every blocked name on every board is a word in danger ink, never a hue);
the coral bans on manifests, roll call, certs, waivers and payments; the roll call committing before
it renders; the claims policy; H-02; and One hand's twelve deletions, which every concept stands on
and none restates.

## Known deviations, on purpose left in

- **The boards are drawn without Reef's decoration** — no water band, no drawn tile, no dial, no
  chip, no coral wash on a staff surface — because the floor proposes exactly that. It is call (b),
  not a decision; if the owner keeps the decoration, the boards are not redrawn and the concepts
  stand with it back on.
- **Concept 6's hero is a gradient labelled as the shop's photograph**; the canvas carries no
  photograph because the app's are the shop's own.
- **Concept 3's Ashore frame uses 14px type and 40px rows on purpose**, under the dock test's floor,
  because the desk is read at arm's length with a mouse and the floor was always for the boat. The
  ADR states the exception; the Aboard frame holds the floor and more.
- **The captures show the demo shop's own date (Thursday, September 10)** rather than the fiction's
  August 27, because they are evidence of the running app and not part of the fiction.

## Slices

Nothing has shipped from this canvas. The floor's first two rows may start on the ADR alone; every
other row and every concept waits on H-73. When a slice lands, the component that must not drift
names the ADR in its doc comment, a test pins the rule, and this table moves.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 21a — the floor: the door goes (a row's own tap is its only door; the trailing verb is the fix) | open | — | — |
| 21b — the floor: the chip and the pill go (`Badge` deleted; a state is a word) | open | — | — |
| 21c — the floor: the decoration leaves every `/shop/**` page (H-73 b) | open | — | — |
| 21d — the floor: the switch goes; Settings becomes the shop's card (H-73 c) | open | — | — |
| 21e — the floor: the outside shrinks — the front page, one embed, every page prints, three connects (H-73 c) | open | — | — |
| 21f — the floor: DiveDay's own pages become three plus the two legal ones (H-73 d) | open | — | — |
| 21g — the picked concept's staff shape (H-73 a) | open | — | — |
| 21h — the boat as its own tool, if the pick includes Ashore and aboard's boat half | open | — | — |
| 21i — the surface: the picked surface's tokens, radius, face and structure on every staff page, and the deletion of Reef's (H-73 e, f) | open | — | — |
| 21j — the diver's side on the picked surface: Harbor's storefront on its rows and controls; the postcard's fate (H-73 g) | open | — | — |
| 21k — DiveDay's own pages on the picked surface (H-73 h), in the slice that shrinks them (21f) | open | — | — |

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (all thirteen artboards on both pages, `canvas.json`, the three
`.jpg` files, the title "Clear the deck"), check it, and republish to the URL above. The seeded output is build
output and is never committed ([design-artifacts.md](../../design-artifacts.md)). The thirteen boards
share one prose stylesheet, pasted verbatim into each between `/* deck:start */` and `/* deck:end */`:
change it in one board and copy the block into the other twelve with a scripted replace, never by
hand and never as a divergent copy. Each round-2 surface carries its own app stylesheet beneath it,
which is the point of the board and is not shared.
