# 20261103-one-card-ledger — Keep every diver card in one ledger, keyed by kind

- **Status:** Accepted
- **Date:** 2026-11-03

## Context

A diver's level, specialty and nitrox cards lived in three tables (`certifications`,
`specialty_certifications`, `nitrox_certifications`) that shared every column but the rung and the
specialty. Each reader that means "this diver's cards" (erasure, merge, the export, the cert
evidence the booking and readiness gates read) had to remember all three, and the export wrote
three files, one of which had silently dropped three provenance columns (issue #2722).

## Decision

One table, `cards`, with a `kind` (`level`, `specialty`, `nitrox`). `level` is set exactly on a
level card and `specialty` exactly on a specialty card (`cards_kind_shape`); the diver's typed
number, the junior wording and the agency-check "listed from" pointer each belong to the kinds
they did before, held by a check. The per-kind rules the three tables held stay per kind: the unique
card-number indexes are partial on `kind`, and the identifier check exempts a numberless shop-issued
card at any status only when it is a level card.

Every gate reads one kind and says so in its query, a lookup by id included, because an id from a
form is not proof of which kind of card it names. Erasure, merge and the export read every kind.
`src/lib/card-ledger.ts` turns a row into the narrower `Certification`, `SpecialtyCertification` or
`NitroxCertification` a rule takes, and throws on the wrong kind.

Ids carried over in a plain copy migration. The three tables stayed for one release,
because the release serving during that migration still read them. The next
release copied any late row and dropped them (issue #3732).

## Alternatives considered

- **A text `code` column for the rung, specialty and `eanx`**, as the issue sketched. Two enum
  columns keep the ladder and the specialty gate typed.
- **Drop the three tables in the same migration.** The serving release would fail every card read
  for the length of the build.
- **Keep the tables and add a view over them.** Every writer would still choose a table, which is
  the duplication the change removes.

## Consequences

- The export writes one `cards.csv` with `kind`, `level` and `specialty` columns, and every
  provenance stamp for every kind.
- A query that forgets its `kind` filter reads other kinds' cards. Database checks keep a row's
  shape honest, but only review and tests keep a gate on its own kind.
- Collapsing provenance into one `source` column, which the issue also proposed, is not part of
  this change.
- A card the old release writes between the copy migration and the cutover lands only in the old
  tables. The drop release copies any such row across before it drops them.
- Until that drop, erasure scrubs the old tables' copy of the diver's cards as well, and a demo
  reset deletes their rows before the people they point at.
- The listed-from and junior-review references do not pin the target's kind; the writers check it.
