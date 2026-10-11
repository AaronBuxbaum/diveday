---
name: adr
description: Record an architecture decision. Use for any hard-to-reverse choice (runtime dependency, storage, auth, external service, data-model spine) or when superseding one.
---

# Write an ADR

## When one is required

New runtime dependency, framework/infra choice, external service, data-model spine, security
posture, or anything expensive to reverse. Not for reversible detail. If unsure: an ADR is one
file — write it.

## Procedure

1. Read `docs/architecture/decisions/README.md` for the ID rules. New records use a
   collision-resistant `YYYYMMDD-kebab-slug.md` ID; do not allocate the next integer.
2. Copy `docs/architecture/decisions/0000-template.md` to that filename, fill every
   section. **At most 500 words** (HTML comments not counted), and `pnpm check:adrs` fails an ADR
   dated after 2026-10-10 that is longer: the decision and the reasons a reviewer needs. The
   incident narrative, measurements and rejected drafts go in the PR, an issue or `docs/`, linked
   from Context. Alternatives get one honest line each; consequences include the escape hatch
   (what triggers revisiting, roughly what leaving costs).
3. Run `node scripts/adr-index.mjs --write`: the README's index gains the row, and
   `pnpm check:adrs` fails while it is stale. A conflict in that table on a rebase is resolved by
   taking either side and running the script again.
4. If the stack changed, update the table in `docs/architecture/overview.md`; if this resolves
   a deferred decision, remove it from that table.
5. Superseding? New ADR states "Supersedes NNNN"; edit the old one's status line to
   "Superseded by MMMM" — never rewrite its content — and rerun the index script, which reads
   the successor from that line.
6. Commit the ADR in the same PR as the change it justifies.
