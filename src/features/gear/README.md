# gear

Rental and repair: the register, counter rentals, fits, the bench and its work orders.

## Owns

- Rentals: `gear-rentals/`, `gear-counter-rentals.ts`, `counter-rental-new-page.ts`,
  `counter-rental-ticket-page.ts`, `rental-terms.ts`, `rental-settings-page.ts`, `rental-note.ts`.
- The register: `gear-register-page.ts`, `gear-import/`, `gear-proposals.ts`.
- The bench: `work-orders.ts`, `work-order-page.ts`, `work-order-new-page.ts`,
  `work-order-follow-up/`, `bench-note.ts` (a service account drafted only from bench notes).

## Does not own

Gear schema and the shared gear clocks (`src/lib/work-orders.ts`, `src/db/schema/`), and what a
diver packs for a trip (`src/features/trips/trip-prep/`).

## Invariants

- A fit is a size record, never an allocation (only a gear reservation reserves a unit), and the
  register never answers what size a diver needs; one tank per diver per planned dive; a nitrox
  request needs a verified card at write time and is re-checked on every read; a diver with no
  fit on file is named on the prep list.
- The bench is rental and repair, never retail (ADR 20261008-gear-work-orders). A work order covers
  a customer's own gear or one shop unit, never both; `picked_up` is terminal and a ticket that
  comes back is a new ticket; the ticket number is the shop's next from 1, allocated under a lock
  on the shop row; the Work done record is the only path from a ticket to a gear clock, and a
  shop unit returns to service only when every check passed.
