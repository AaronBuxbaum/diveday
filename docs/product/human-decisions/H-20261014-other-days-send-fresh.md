# H-20261014-other-days-send-fresh: How does one booking's page lead to the diver's other days with the shop?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

**How does one booking's page lead to the diver's other days with the shop?** A diver with several bookings holds one link per booking and no way between them. Raised by the fifth-loop ideas, decision 6.

## Minimum outcome to record

The choice, and where it is said.

## Outcome

**Decided 2026-10-14 (Product owner: Aaron Buxbaum, in the project thread, "Do recommended decisions for each", taking the recommendation):** From one booking's page, each other day with the shop is a row that sends a fresh link to the email on file; no link opens another booking directly.

**Revised 2026-11-06 (Aaron, defensive-choices audit, issue #4059):** on a delivered link each row opens that day's own page directly; the link a booking redirects to still lists no other day.

## Unblocks / follow-up

Built by layer r5-4: "Your days with us" on `/ready`, each row a send of a fresh link to the email on file ([20261016-fresh-link-per-booking-row](../../architecture/decisions/20261016-fresh-link-per-booking-row.md)).

Part of the [human decision log](README.md#decision-register).
