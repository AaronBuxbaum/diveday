# 20261115-personal-computer-evidence — Keep imported computer evidence on the person

- **Status:** Accepted
- **Date:** 2026-11-15

## Context

Aaron requested file import from dive computers. Shared executed dives describe the crew's
trip evidence. An individual's instrument trace can differ and must never silently change
readiness, roll call, recency, no-fly or shared dive records.

## Decision

Store import receipts, person-scoped computer dives and bounded profiles in separate tenant
scoped tables. Parse in memory, preview every recording and require selection plus target-person
confirmation. Reparse on commit. Store normalized evidence and provenance, not raw files.
A unique person-scoped fingerprint recognizes exact records including deleted records. A request
key binds a selection and returns its original result on retry. Similar records remain separate.

Preserve local wall time and source offset independently. Missing zones remain unknown unless a
staff member explicitly supplies an offset; never infer the shop's zone. Missing measurements
remain null. UDDF uses SI units; CSV headers must name units. Advertise only fixture-proven format
subsets; synthetic fixtures establish no vendor compatibility. FIT requires the official SDK and
representative evidence before enablement. No device connectivity promise is made.

Every operation checks live staff membership and tenant/subject identity. Mutations lock subject,
actor, active account and role evidence while committing. Person lifecycle registries govern
merge, erasure, reset and export. A merge fingerprint collision refuses atomically, preserving both
records and annotations for explicit correction. Deletion is reversible; annotations do not edit
instrument evidence. This is an attachment to the core diver record, offered only when staff
opens that person's import workflow, rather than a separate staff destination or safety feature.

## Alternatives considered

- **Reuse executed dives** — would confuse individual and crew evidence.
- **Keep raw uploads** — unnecessary retention of private data and parser inputs.
- **Infer local zones** — cannot resolve DST folds or a travelling computer honestly.
- **Silently merge similar dives** — could discard separate computers or repeat dives.

## Consequences

Personal evidence is portable and erasable without changing operations. Failed imports save
nothing. Exact duplicates can be restored after deletion. Supporting further exports requires
sanitized representative fixtures and parser tests. Revisit storage if profile sizes outgrow the
bounded JSON representation; moving profiles to chunks leaves dive identity unchanged.
