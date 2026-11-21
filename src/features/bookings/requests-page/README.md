# requests-page

This module owns the requests page use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped request/departure reads and unresolved crew-away counts from the existing crew schedule reader.
- `rules.ts`: groups recorded interests and date choices, keeping unknown party sizes separate from stated headcounts.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks.

## Planning boundary

The comparison is page-scoped, and requests can appear on several dates. Seat counts stay per departure, private departures are labeled, and whole-boat requests are not compared with shared seats. Crew assignments and unresolved time away are evidence to review, not an availability or qualification decision. No model call, booking, crew assignment, or safety clearance is performed.
