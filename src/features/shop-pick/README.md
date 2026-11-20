# shop-pick

This module owns the one departure or course a shop features on its public page (#4823) and publishes its contract through `index.ts`.

## Owns

- `store.ts`: what the profile page offers, the write, and the read the storefront draws.

## Does not own

The columns (`shops.pick_trip_id`, `shops.pick_course_id`), the card, and the settings field.

## Invariants

A pick is read back through the live, public, still-ahead scope, so one that has sailed, gone private or been deleted stops showing without a cleanup job. At most one of the two columns is set.
