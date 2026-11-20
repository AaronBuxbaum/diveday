# boat-day

One shop day across all its boats, with the collisions between departures (issue #4258).

## Owns

- `store.ts`: the day's departures with boat and crew, and `dayCollisions` over them.

## Does not own

The collision rule (`src/features/boat-day/rules.ts`) and the screen (`schedule/boats`).

## Invariants

Scoped by shop. A collision informs; it never blocks a departure or a crew assignment.
