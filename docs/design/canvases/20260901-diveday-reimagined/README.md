# DiveDay, reimagined — three directions

- **Status:** Live (its ADR is Proposed — the pick is pending)
- **Date:** 2026-09-01
- **ADR:** [20260901-diveday-reimagined](../../../architecture/decisions/20260901-diveday-reimagined.md)
- **Published:** _pending first save_

The seventh design canvas, and the first that argues a *direction* rather than a surface. The owner's
brief: nothing needs to stay the way it is; people should think "wow" using DiveDay, and a shop
leaving FareHarbor should be easily swayed. Three directions redraw the same four surfaces for the same
shop on the same day so they compare like for like. **Nothing here is normative**; the ADR carries the
decision, and it holds that decision open until one direction is picked.

## Artboards

One page. One row per surface, one column per direction; the cover sits above the grid.

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

## Slices

The pick comes first; the implementation slices are written into this table when the ADR moves to
Accepted, tokens first so every surface moves together.

| Slice | Status | Lands in | Pinned by |
| --- | --- | --- | --- |
| 1 — the pick: one direction chosen, the ADR Accepted with its decisions | open | — | — |

## Working on it

The sources here are the working files. To change a board, edit its `.dc.html`, re-seed a fresh
copy with the design skill's helper (every artboard, `canvas.json`, the title "DiveDay, reimagined"),
check it, and republish to the URL above. The seeded output is build output and is never committed
([design-artifacts.md](../../design-artifacts.md)).
