# H-56: What provenance should a self-declared card carry before a staff sighting?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

What provenance should a self-declared card carry before a staff sighting? (Issue #612.)

## Minimum outcome to record

A visible state that cannot be mistaken for a staff-verified credential, without inventing a person-attribution field the product cannot support.

## Unblocks / follow-up

**Decided 2026-08-22 (Aaron Buxbaum):** label the declaration **unverified** and do not add `declared_by_person_id`; the declaration is the diver's claim until a staff sighting changes its state. Readiness and every downstream gate use that distinction.

Part of the [human decision log](README.md#decision-register).
