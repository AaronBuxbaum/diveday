# H-149: When do crew arrive at the dock?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**With no shift entered, crew read the divers' dock call, so crew who arrived with the customers left tanks unloaded and the O2 unchecked.** The 2026-10-22 ux-delight sheet (item 2, call 1) offered: shop-wide, default 30 minutes before divers; shop-wide, off until the owner sets it; or per boat.

## Decision

**Decided 2026-10-22 (Aaron: Recommended, in the project thread): shop-wide, default 30 minutes before divers.** A crew member's own shift covering the departure still wins; a shop that clears the setting gives crew the divers' time, named as the divers'.

## What shipped

`shops.crew_lead_minutes` (nullable, default 30, 5 to 180), set on Settings › Dock-day rhythm as "Crew arrive before divers". `crewCallAt` (`src/lib/dock-call.ts`) reads shift, then the crew time, then the divers' call; crew "Your week" on Today says "At the dock 6:00 AM" from it.

## Unblocks / follow-up

None.

Part of the [human decision log](README.md#decision-register).
