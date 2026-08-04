# 20260804-incident-export-owner-gate — The incident-ready export is the owner's to produce

- **Status:** Accepted
- **Date:** 2026-08-04

## Context

The incident-ready export (`/shop/<slug>/trips/<id>/incident-export`) assembles one departure's
complete evidentiary record: every diver on the roster with their certification evidence and waiver
*status*, emergency contacts, the full append-only roll-call timeline with every recorder named, the
buddy-team trail, and a SHA-256 integrity code so a printout can be checked against a fresh export.
It stamps the person who generated it into the document by name.

It shipped reachable by any staff member, because it is reached from the manifest and the manifest is
reached by the whole crew. The product owner's instruction is that it should be **Owners only**.

That is a different question from who runs the roll call, and the two got conflated because they
share a doorway. Every other staff surface is gated on whether the work is that person's job. This
one is gated on something else: the document exists to be handed *outside* the shop — to authorities,
to an insurer — and it is the business's own account of what happened on a day when something went
wrong. Producing it is not an operational task that happened to land on the manifest; it is the shop
speaking for itself.

## Decision

1. **`canExportIncidentRecord(roles)` — owner only.** Deliberately stricter than
   `canExportShopData` / `canViewShopReports` (owner-or-manager) and than `canConfigureTrips`
   (owner/manager/instructor). It joins `canErasePersonalData` as the second predicate in
   `src/lib/authz.ts` that stops short of owner-or-manager, and for a related reason: both are acts
   whose consequences land on the business's legal position rather than on the day's operations.

2. **The manifest stays open to the whole crew.** They run the roll call; gating what they need to
   sail would be absurd, and every fact the export draws on is already on the manifest they are
   looking at. What is gated is the *assembly and attribution* of those facts into a signed artefact.

3. **Two enforcement points, and the route is not the gate.**
   - The manifest hides the link (`canPersonExportIncidentRecord`), so nobody is shown a button they
     will be bounced from — the same "hide, don't explain" rule as ADR
     20260724-role-gated-surfaces-hide-not-explain.
   - The route refuses however it was reached — a bookmark, a deep link, a role that changed under
     them — **before** any document data is fetched.
   - `getIncidentExport` re-checks the gate **itself** and returns `null` on refusal, the same way
     `createOrder` and `anonymizeDiver` re-check theirs. Today the route is its only caller, so this
     is belt and braces; the point is that read-only-looking helpers acquire callers (a PDF endpoint,
     a cron, an "email the insurer" action), and "the route forgot to check" must never be the thing
     standing between a captain and the document (security review 20260804).

4. **Roles are read live from the database**, not from JWT claims, via `loadActiveStaffRoles` — so a
   demoted, disabled, or deleted owner loses the export on their next request rather than at their
   next sign-in. Same revocation window as every other `canPerson*` gate.

5. **The refusal lands somewhere with a reason.** Non-owners are redirected to the trip's manifest
   with `?notice=incident_export_not_authorized`, which renders a plain notice saying the export is
   owner-only and that everything it draws on is on this page. A refusal that teleports you somewhere
   silently is indistinguishable from a dead link (task 82). Not a `notFound()`: the trip exists and
   the person may legitimately read it, so pretending otherwise would be a lie about their own shop.

## Alternatives considered

- **Owner-or-manager**, matching the full-shop export. The full-shop export is an administrative
  bulk operation a manager plausibly runs as routine work. This is a per-incident legal artefact
  naming its generator, produced on the worst day the shop has. Different act, tighter gate.
- **Leave it open to all staff and rely on the audit trail.** The document already records who
  generated it — but recording who did a thing is not the same as deciding who may, and a captain
  one tap from producing the shop's account of an incident is a decision nobody made.
- **`notFound()` for non-owners.** Leaks nothing, but reads as a broken product to a manager who can
  see the trip, the manifest, and the roll call, and is told the export does not exist.
- **Gate the manifest too.** Wrong surface: the crew cannot sail without it, and it holds no
  attribution or integrity code.

## Consequences

On the day it matters, only an owner can produce the document. For a single-owner shop that is a
single point of failure — if the owner is unreachable, nobody can generate the export until they
are, and the underlying facts have to be read off the manifest instead. That is the accepted cost of
the instruction; the facts themselves remain visible to the crew throughout, and nothing about the
record is lost or delayed, only its assembly into an artefact.

`canExportIncidentRecord` is now the strictest gate in `src/lib/authz.ts` alongside
`canErasePersonalData`, which makes it the one most likely to be "relaxed to owner/manager for
convenience" by pattern-matching its neighbours. It is pinned at three layers against that: the pure
predicate (`src/lib/authz.test.ts`), the live DB path including the manager case
(`src/db/authz.test.ts`), and end to end as an instructor (`e2e/incident-export.spec.ts`).
