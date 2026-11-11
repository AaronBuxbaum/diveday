# trip-sightings

This module owns the trip sightings use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

Catalog sightings use localized species names. Custom sightings preserve crew-written text in
`custom_name` and use a normalized SHA-256 identity in `species_slug`, prefixed `custom:`.
They share the same tenant checks, soft-delete and atomic increment behavior. The site summary
renders their text, but catalog suggestions, preset chips and the curated monthly photo shelf
never learn from custom sightings.
