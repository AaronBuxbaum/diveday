# home-diver-door

This module owns the home diver door use case and publishes its contract through `index.ts`.

## Owns

- `rules.ts`: reads `HOME_DIVER_DOOR`, the switch for the home hero's "Find your booking" line.

## Does not own

The line itself (`src/app/_components/DiverDoor.tsx`) and the page it opens
(`src/app/(marketing)/find-your-booking/page.tsx`) stay in their existing layers.

## Invariants

The line is hidden unless `HOME_DIVER_DOOR` is exactly `1`. Turn it on once at least one shop is
listed on `/find-your-booking`.
