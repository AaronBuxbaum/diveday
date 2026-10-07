# H-88: Which physical thing is DiveDay — the day, the boat, or the sea?

- **Status:** Chosen
- **Human owner:** Product owner

## Decision or approval needed

**Which physical thing is DiveDay — the day, the boat, or the sea?** The 2026-09-19 loop ([canvas](../../design/canvases/20260919-one-idea/README.md), ADR [20260919-one-idea](../../architecture/decisions/20260919-one-idea.md)) answered the owner's read of H-87's round 2 — still not thinking big enough; the whole thing, top-down, needs complete rethinking — by putting the entire current app on one sheet (57 distinct surfaces), naming why fifteen canvases restyled the same skeleton (each answered its brief at the altitude it was asked, and none asked what the app *is*), stating the test (name the physical thing the app is; "a list" means the design is not done), and drawing three whole products on the same fiction and the same six screens, each on one thing a dive shop already thinks in: **I · Tide** (the app is the day: the sky at the shop's own hour, the boats on the hours they leave, the tide under them, a line for now), **II · Deck** (the app is the boat: each hull an object in its own colour, its seats the record, roll call as tapping seats), **III · Chart** (the app is the sea: the shop's own water north up, the sites where they are, today's boats on their tracks). Recommended: **I · Tide**, with the departure drawn as Deck's hull and a site as Chart's chart inside it — every shop has a day, the day is what the product already knows most about, it answers H-77's reads without a toggle, and it composes in one direction.

## Minimum outcome to record

One numeral: I, II or III. **Decided 2026-09-19 (Aaron Buxbaum, in session): I · Tide**, with Deck's hull as the departure and Chart's chart as the site inside it — "I like this. Build it, ensuring that the real build looks as much like the design as possible." The app is the day: the sky at the shop's own hour, the boats on the hours they leave, the tide under them, a line for now; no tabs, no More, no dock. II and III stay on the canvas as alternatives, and the two parts Tide composes land inside it. The build opens as one stack under roadmap 23, bottom-up.

## Unblocks / follow-up

Round 2's surface rows (22a, 22b, 22i) and 22c land first; 23a–23h are the build. H-87 is withdrawn (three skins on one skeleton); H-77's (c) and (d) stay open there; One hand's 20f–20m stay paused. Deck adds one column (`boats.hull_color`); Chart's coastline is a follow-up ADR.

Part of the [human decision log](README.md#decision-register).
