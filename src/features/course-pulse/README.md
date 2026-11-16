# course-pulse

This module owns the course pulse use case and publishes its contract through `index.ts`.

## Owns

- `store.ts`: scoped readers and recorded transitions.
- `rules.ts`: domain rules and use-case helpers.

## Does not own

Schema definitions, shared primitives, routes, and UI stay in their existing layers.

## Invariants

Imports from other features use their published index. Database reads and mutations retain their existing tenant and authorization checks. This move changes ownership, not behavior.

## Student follow-up

The existing preparation rows show every enrolled student and missing forms, card, payment, materials, or staff follow-up. Authorized instructors and shop managers can take responsibility for a student's follow-up. Owners and managers can release another staff member's claim; assigned instructors can release only their own. The owner, claim time, and revision belong to that booking on that session, never to another session in the course.

A claim means work is in progress while gaps remain. Preparation completion is always recomputed from existing readiness and course-material records, without a manual completion flag, agency check, certification decision, or boarding write. Held identities expose only the generic staff-follow-up category. An optimistic revision prevents two tabs from overwriting each other's claims, and claim/release changes append staff activity in the same transaction. Existing booking retention, staff attribution, and activity erasure policies apply; no student names, medical details, or free-text task notes are copied into ownership records.

Design considered a separate cohort task board and inline ownership on the existing preparation rows. Inline ownership was chosen because the missing categories and their source records already live on that departure. Browser and capture validation must respect the session's explicit restrictions; source and database checks do not establish rendered quality.
