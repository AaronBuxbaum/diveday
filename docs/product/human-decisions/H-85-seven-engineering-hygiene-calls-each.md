# H-85: Seven engineering-hygiene calls, each a pick-one, none needing a product opinion:

- **Status:** Deferred
- **Human owner:** Product owner

## Decision or approval needed

**Seven engineering-hygiene calls, each a pick-one, none needing a product opinion:** a Biome caret that turns Lint red on every open pull request the day a patch publishes (#1742); ADR code citations nothing verifies (#1738); a zero-pixel visual threshold that promotes a surface to *changed* on two stray pixels (#1687); ~854 PNGs published per run across ~91 daily runs, which is where the S3 request bill actually is (#1661); no mechanical guard on tenant-scoped writes (#1714); a trace exclusion that strips the rasterizer from the staff year card (#1710); and an uptime monitor that polls `/api/health` rather than a page that renders (#1474).

## Minimum outcome to record

A mechanism per item, or a deliberate deferral.

## Unblocks / follow-up

**Deferred 2026-09-16 (Aaron Buxbaum, ready-for-human decision deck): all seven, until after pilot.** None blocks a shop, and the deck's recommendation to batch-approve four of them was considered and declined. All seven carry `parked` rather than `ready-for-agent`, so they read as deliberate rather than forgotten. Two consequences are recorded here rather than discovered later. **#1742 will recur**: the day Biome publishes a patch release the CLI moves, the `$schema` string cannot follow it, and every open pull request goes red at once on diffs that could not have caused it — the fix is a one-line exact pin, and the cost of the deferral is a morning each time it fires. **#1474 was already named as the gap** in this file's own "Immediate actions" section, which records that the rendering check is the one thing the external monitor does not cover and that it needs a pilot shop's slug to point at — so this deferral is consistent with that entry rather than new.

Part of the [human decision log](README.md#decision-register).
