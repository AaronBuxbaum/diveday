# H-20261022-crew-arrive-before-divers: When do crew arrive at the dock?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**With no shift entered, crew read the divers' dock call, so crew who arrived with the customers left tanks unloaded and the O2 unchecked.** The 2026-10-22 ux-delight sheet (item 2, call 1) offered: shop-wide, default 30 minutes before divers; shop-wide, off until the owner sets it; or per boat.

## Decision

**Decided 2026-10-22 (Aaron: Recommended, in the project thread): shop-wide, default 30 minutes before divers.** An entered shift of the crew member's own wins only when it starts earlier (dive-domain review of layer 1), so a shift never makes the call later; a shop that clears the setting gives crew the divers' time, named as the divers'.

## What shipped

`shops.crew_lead_minutes` (nullable, default 30, 5 to 180), set on Settings › Dock-day rhythm as "Crew arrive before divers". `crewCallAt` (`src/lib/dock-call.ts`) reads the crew minutes before the divers' call (or the divers' call when none is set), and an earlier shift of their own still running at that call wins; crew "Your week" on Today says "At the dock 6:00 AM" from it.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
