---
name: adr
description: Record an architecture decision. Use when making any significant hard-to-reverse choice — new runtime dependency, storage, auth, external service, data-model spine, or when superseding a previous decision.
---

# Write an ADR

## When one is required

New runtime dependency, framework/infra choice, external service, data-model spine, security
posture, or anything expensive to reverse. Not for reversible detail. If unsure: an ADR is one
file — write it.

## Procedure

1. Next number: check `docs/architecture/decisions/README.md` index.
2. Copy `docs/architecture/decisions/0000-template.md` to `NNNN-kebab-slug.md`, fill every
   section. Keep it under a page. Alternatives get one honest line each; consequences include
   the escape hatch (what triggers revisiting, roughly what leaving costs).
3. Add the row to the index in `decisions/README.md`.
4. If the stack changed, update the table in `docs/architecture/overview.md`; if this resolves
   a deferred decision, remove it from that table.
5. Superseding? New ADR states "Supersedes NNNN"; edit the old one's status line to
   "Superseded by MMMM" — never rewrite its content.
6. Commit the ADR in the same PR as the change it justifies.
