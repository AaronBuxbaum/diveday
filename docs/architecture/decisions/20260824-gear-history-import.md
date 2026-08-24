# Gear register history import

## Decision

The switching import now accepts a separate gear-history CSV. It imports the
shop's own tagged fleet and its dated service records, including manufacturer
service, hydro tests, visual inspections, O2 cleaning, and condition notes.

The import is intentionally separate from the diver/contact CSV: equipment
history belongs to a shop-owned unit and source exports often contain no diver
identity. Units match an existing live unit by tag first, then serial number;
otherwise the importer creates the unit. Service rows are appended to the
unit's existing history and an exact re-import is ignored.

The supported starter columns are `gear_label`, `gear_kind`, `gear_size`,
`serial_number`, `brand_model`, `purchased_on`, `service_kind`, `serviced_on`,
`next_due_on`, `next_due_dives`, and `service_note`. Unknown columns remain
visible to the operator and are not guessed into the register.

This does not import work orders, parts, labor, vendor invoices, customer-owned
gear, historical rental assignments, or payment credentials. Those concepts
have no destination in the current register and remain outside this import.
