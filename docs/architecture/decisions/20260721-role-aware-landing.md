# 20260721-role-aware-landing — Today leads with the signed-in role's work, via a lens, not per-role pages

- **Status:** Accepted
- **Date:** 2026-07-21

## Context

Role was cosmetic: the shop layout computed it only to label the demo role switcher, and every
staff member landed on an identical Today. The UX audit (P2) called for a captain's Today to lead
with their boat and the boat loop, and an instructor's with their sessions and student readiness.
Crew-to-trip truth already exists in `trip_assignments`; roles live on `person_roles` and ride the
session (`session.user.roles`, `session.user.personId`).

The broad-but-reversible choice is *how* role shapes the product: separate per-role landing pages
and navigation, or one shared Today that reorders and prefixes itself.

## Decision

- **One Today for everyone; role picks a lens over it.** `roleLensFor(roles)` in `src/lib/today.ts`
  maps roles to a lens: owner/manager → none (they triage everything), instructor → **sessions**,
  divemaster/captain → **boat**. Instructor wins over boat roles for people holding both, matching
  the demo switcher's precedence.
- **The lens is additive and derived from `trip_assignments`.** `getTodayWork` optionally takes the
  session's `personId` and returns which in-window trips that person crews plus a readiness summary
  per crewed course session. The **boat** lens sorts the crewed departure first on the departure
  board and badges it "You're crewing"; the **sessions** lens adds a "Your sessions" section —
  this week's crewed course sessions with student readiness — above the shared board.
- **No per-role routes, navigation, or authorization changes.** Every staff role keeps every
  surface; the lens changes emphasis and order only. Authorization stays exactly ADR-0006.
- **Unassigned means unchanged.** A captain crewing nothing today sees the standard Today; the lens
  never renders an empty section.

## Alternatives considered

- **Per-role landing pages (`/shop/x/captain`, …).** Rejected: duplicates the queue's assembly and
  empty states per role, splits the operational picture the roles share, and makes role changes a
  navigation migration. The lens is one sort key and one section.
- **Configurable per-user dashboards.** Rejected as speculative; nothing demands persistence or
  customization yet, and the lens leaves room for it later without migration.

## Consequences

- Role-shaped landing ships with no schema change and no new routes; reverting is deleting the lens
  branch points.
- The lens is only as good as crew assignment habits — a shop that never assigns crew sees no
  difference. That is honest: DiveDay should not guess who is on the boat.
- If a future role needs more than emphasis (e.g. a captain-only surface), that is a new decision,
  not an extension of this one.
