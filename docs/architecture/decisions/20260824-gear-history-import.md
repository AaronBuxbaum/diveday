# 20260824-gear-history-import — Gear register history import

- **Status:** Accepted
- **Date:** 2026-08-24

## Context

Shops switching to DiveDay need to carry the care history of their tagged
fleet. They also need historical rental assignments now that DiveDay manages
which gear is assigned to people. These records are source evidence, not live
reservations or bookings.

## Decision

The switching import accepts a separate gear-history CSV. It imports tagged
units and dated service, hydro, visual, O2-clean, and condition records. Units
match by tag first, then serial number; otherwise the importer creates the
unit. Exact service re-imports are ignored.

Rows may also contain `person_email` or `person_name`, `assigned_from`,
`assigned_until`, `assignment_status`, `assignment_reference`, and
`assignment_note`. Matching assignments are stored in
`prior_gear_assignments`, shown in the unit's rental history, and deduplicated.
They never create a booking, block availability, or become actionable live
reservations. Unmatched people are reported while the unit/service row remains
importable.

## Alternatives considered

- Put historical assignments in `gear_reservations`: rejected because that
  would affect availability and require a booking that did not exist.
- Put assignments only on the diver: rejected because the gear unit is the
  other essential side of the historical relationship.
- Reconstruct bookings and payments: rejected because source exports do not
  provide enough authoritative evidence.

## Consequences

The import template carries both service and assignment fields. Work orders,
parts, labor, vendor invoices, customer-owned gear, ownership transfers, and
payment credentials remain outside this import until their own models exist.
