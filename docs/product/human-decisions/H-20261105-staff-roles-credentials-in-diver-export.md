# H-20261105-staff-roles-credentials-in-diver-export: Do a staffer's roles and pro cards belong in their own data export?

- **Status:** Implemented
- **Human owner:** Product owner

## Decision or approval needed

Since #3864 the diver export reads only what the person-column registry calls `own`. `person_roles.person_id` and `staff_credentials.person_id` were withheld (issue #3881): should a person who is also staff get their roles and pro cards back?

## Minimum outcome to record

Which of the two rows ship in the diver export.

## Unblocks / follow-up

**Decided option (c), 2026-11-05 (Aaron Buxbaum):** both ship. Roles are a `roles` column in `profile.csv`; credentials are `staff_credentials.csv` without the staff-typed review note or the reviewer's and remover's ids. Erasure is unchanged. A full shop export-then-import round trip is its own ticket (#3889).

Part of the [human decision log](README.md#decision-register).
