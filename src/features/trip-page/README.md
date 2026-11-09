# trip-page

This module owns the trip page use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. The common manifest retains all roster/readiness and permission reads. Fleet, lenses and conservation are deferred until the route resolves Details, including notices that force that tab; normal Divers reads never start them.
