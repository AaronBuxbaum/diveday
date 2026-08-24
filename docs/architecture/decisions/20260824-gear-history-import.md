# Gear register history import

## Decision

The switching import now accepts a separate gear-history CSV. It imports the
shop's own tagged fleet and its dated service records, including manufacturer
service, hydro tests, visual inspections, O2 cleaning, and condition notes.
It also accepts historical rental assignments when a row identifies an
existing diver and a date range.

The import is intentionally separate from the diver/contact CSV: equipment
history belongs to a shop-owned unit and source exports often contain no diver
identity. Units match an existing live unit by tag first, then serial number;
otherwise the importer creates the unit. Service rows are appended to the
unit's existing history and an exact re-import is ignored.

The supported starter columns are `gear_label`, `gear_kind`, `gear_size`,
`serial_number`, `brand_model`, `purchased_on`, `service_kind`, `serviced_on`,
`next_due_on`, `next_due_dives`, and `service_note`. Unknown columns remain
visible to the operator and are not guessed into the register.
Assignment rows may additionally use `person_email` or `person_name`,
`assigned_from`, `assigned_until`, `assignment_status`,
`assignment_reference`, and `assignment_note`. Assignments are stored in
`prior_gear_assignments`, separate from live reservations: they are display-only,
deduplicated, and never block availability or create a booking.

This does not import work orders, parts, labor, vendor invoices, customer-owned
gear, ownership transfers, or payment credentials. Those concepts
have no destination in the current register and remain outside this import.
