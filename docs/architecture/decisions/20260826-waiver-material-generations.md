# 20260826-waiver-material-generations — A human marks whether a new waiver version changes the bargain

- **Status:** Accepted
- **Date:** 2026-08-26
- **Issue:** [738](https://github.com/AaronBuxbaum/diveday/issues/738)

## Context

Waiver text is append-only and versions must keep incrementing, but a typo or formatting correction
should not silently force every diver to sign again. Conversely, DiveDay cannot infer legal
materiality from a text diff. The product owner answered issue #738 yes: a shop may make that
assertion explicitly.

## Decision

Each `waiver_templates` row carries a `material_generation`. A published version increments the
generation when the publisher selects **material** and keeps the generation when they select
**non-material**. `waiver_records` snapshots the generation alongside the display version, and
signature currency compares generations. Display versions remain monotonic and immutable.

Every explicit choice is appended to `waiver_materiality_decisions` with the shop, template,
actor, timestamp, and answer. The editor offers no inferred default when standing signatures are at
risk; the publisher must choose one of the two consequences. A save with no standing signatures
keeps the conservative material default for compatibility with the first release.

## Consequences

- A non-material correction does not create a mass re-signing queue.
- A material revision still invalidates standing signatures through the existing readiness path.
- The legal assertion is auditable and never overwritten; changing one's mind is another published
  version and another trail row.
- H-01–H-03 remain open: this mechanism records a shop's choice but does not make a waiver legally
  sufficient in any jurisdiction.

## Alternatives considered

- **Infer materiality from a text diff** — rejected because legal materiality is a shop's assertion,
  not a property a string comparison can establish.
- **Keep only a display-version flag** — rejected because standing-signature currency needs an
  immutable generation that changes only for material edits.
- **Add a second waiver template type** — rejected because the shop-wide waiver remains the single
  legal instrument; this decision records an explicit consequence for each published version.
