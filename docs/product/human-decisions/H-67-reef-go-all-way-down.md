# H-67: Does Reef go all the way down, and does the delight budget widen along…

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Does Reef go all the way down, and does the delight budget widen along time?** The 2026-09-04 loop ([canvas](../../design/canvases/20260904-reef-all-the-way-down/README.md), ADR [20260904-reef-all-the-way-down](../../architecture/decisions/20260904-reef-all-the-way-down.md)) measured the shipped surfaces against Reef's drawings from the running app — the home's stations are a rail list where Reef drew panels, the public booking page is 5,782px at 390 before its form — gave each of the thirty-six open feature issues one verdict (eighteen drawn onto the surfaces, eleven adopted unseen, three folded, three held, one declined), and proposes eight budget rules that let the product know what time it is: the water band takes one of four washes by the shop's clock, the boat is the hand's eighth drawing and the only one that moves, one fact of scale renders on the day it is true, a crew-set stage reads on every surface the boat is drawn on. Every existing ban stands and each rule renders nothing when it is not true.

## Minimum outcome to record

**(a)** Yes or no to the widened budget as drawn — the clock, the moving boat, the fact of scale — or which of the three to strike. **(b)** D05's revision counter: which edits bump it (recommended: a change to `starts_at` or the site list) and where it lives (recommended: `trips.revision`). **(c)** The two phrases that print to a diver: "Dive day № 3" on the postcard, and the five stage words *Boarding · Out on ⟨site⟩ · On the surface · Heading in · Home*.

## Unblocks / follow-up

**Decided 2026-09-04 (Aaron Buxbaum, in session):** **(a)** the budget widens as drawn — the band follows the shop's clock, the boat joins the hand as the one drawing that moves, one fact of scale renders on the day it is true; every existing ban stands. **(b)** `trips.revision`, an integer bumped by a change to `starts_at` or the site list, emitted by the `.ics` as `SEQUENCE`. **(c)** as drawn — "Dive day № 3" on the postcard's face, and the five stage words *Boarding · Out on ⟨site⟩ · On the surface · Heading in · Home*. The ADR is Accepted with those decisions; slices 16a–16j in the roadmap, 16a started the same day.

Part of the [human decision log](README.md#decision-register).
