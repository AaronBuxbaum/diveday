# 20260724-role-authorization — Role boundaries on five staff surfaces

- **Status:** Accepted
- **Date:** 2026-07-24

## Context

DiveDay's staff roles (`owner`, `manager`, `instructor`, `divemaster`, `captain`, `crew`) all
resolved to a single `isStaff` gate for almost every staff surface: any signed-in staff member
could reach payment settings, issue refunds, edit the waiver template, delete a diver, and
configure trips. The [2026-07-24 staff-session/capability codebase review](20260724-staff-session-and-capability-migration-policy.md#context)
raised this as an open human-owned decision, because the product language implies a split — owners
and managers configure money and policy, instructors own course sessions, and captains/crew/divemasters
run the day on the water — that the code did not enforce. The product owner decided (H-14, 2026-07-24)
that yes, real boundaries are needed on five surfaces.

The existing accountable-role gates — `canExportShopData` / `canImportShopData` /
`canViewShopReports`, all owner/manager (see [full-shop-export](20260722-full-shop-export.md),
[contact-importer](20260723-contact-importer.md), [owner-reporting](20260723-owner-reporting.md)) —
already establish the pattern this decision extends.

## Decision

Add five role predicates to `src/lib/authz.ts`, each guarding one surface, and enforce each in
**both** layers the codebase already uses: the page that renders the surface and the server
action(s) that mutate it, never one alone (ADR-0006). The UI additionally hides the control from
roles that lack it, so a crew member is never shown a button they would be bounced from — but
hiding is presentation, not a security layer.

Enforcement checks the person's **live** roles, re-read from the database, not the roles baked into
the JWT — mirroring the export/import/reports surfaces (`canPersonViewShopReports`). A shared
`loadActiveStaffRoles(db, shopId, personId)` in `src/db/authz.ts` loads the person (not deleted),
their account (active), and their `person_roles`, and each surface's `canPersonManagePaymentSettings`
/ `canPersonRefund` / `canPersonManageWaiverTemplates` / `canPersonDeleteDiver` /
`canPersonConfigureTrips` applies the matching predicate to that live set. So a manager demoted,
disabled, or deleted mid-session loses these surfaces immediately, closing the same revocation
window H-15 left open for ordinary mutations but which money, legal text, and roster deletion are
too sensitive to keep. A denied staff member is authenticated but not allowed: pages render a
warning `ShopNotice` in place of the control (no redirect, matching reports/export/import), route
handlers return 403, and server actions refuse (early return or an error state).

| Surface | Predicate | Roles admitted |
| --- | --- | --- |
| Payment settings (Stripe Connect, rental catalog/prices) | `canManagePaymentSettings` | owner, manager |
| Refunds (money leaving the account) | `canRefund` | owner, manager |
| Waiver templates (the legal instrument) | `canManageWaiverTemplates` | owner, manager |
| Diver deletion (soft-delete a person, freeing their email) | `canDeleteDiver` | owner, manager |
| Trip *definition* (create, edit details, admission requirements, whole-series ops, reinstate) | `canConfigureTrips` | owner, manager, instructor |

Trip *definition* opens to instructors because course sessions and their admission rules are
instructor-owned work; the other four stay owner/manager because they are money, a legal document,
or an irreversible-feeling roster change. Captains, crew, and divemasters keep every *operating*
surface — the roster, check-in, manifest, roll call, gear packing, readiness — which none of these
predicates touch.

The trip gate is drawn deliberately at *definition*, not "everything on the trip Overview". Three
Overview actions the glossary assigns to the day-of crew stay on `requireStaffSession` (open to all
staff), because a fun charter crewed by a captain and a divemaster with no instructor aboard must
still be able to run its day:

- **Predicted conditions** (`saveConditionsAction` / `clearConditionsAction`) — the crew who were on
  the water record water temp, visibility, and surface state; the glossary makes this a crew
  observation and gives the crew the go/no-go call.
- **Day-of crew assignment** (`saveCrewAction`) — the crew list is part of the manifest, a legal
  safety document, and must stay truthful when the on-water lead swaps a sick divemaster or a second
  captain at the dock.
- **A single trip's weather cancellation** (`cancelTripAction`) — the crew's go/no-go call, taking
  today's charter off the board so booked divers are notified. It only flips trip status; no money
  moves (per-booking refunds stay on the owner/manager path). Reinstating a trip and cancelling a
  whole recurring series are bulk schedule management and stay `canConfigureTrips`.

So `canConfigureTrips` guards trip *definition* and bulk schedule management; the day-of operating
actions above are not gated by it. This split came out of the `dive-domain-expert` review, which
flagged the first cut as one notch too wide.

## Alternatives considered

- **A general permission matrix / RBAC table in the database.** Overkill for six fixed roles and
  five surfaces, and it would move the policy out of typed code (where `pnpm typecheck` proves every
  surface is covered) into data. Predicate functions keep the rules greppable and unit-tested.
- **Route guard only.** Rejected by ADR-0006 — the proxy/route layer is never the sole gate; a
  server action reachable by a crafted POST must re-check. Both layers, always.
- **Hide the UI only.** Hiding is a courtesy, not a control: the action must refuse regardless of
  what the client rendered.

## Consequences

- Six roles now diverge in what they can reach. Existing e2e sign-ins use the owner, so most specs
  are unaffected; a role-lens e2e exercises a crew member being denied the five surfaces and an
  instructor being allowed trip config but denied the money/legal ones.
- Enforcement is safety- and money-adjacent, so this change carries a `security-reviewer` and a
  `dive-domain-expert` review before merge (AGENTS.md hard rules).
- New staff surfaces must consciously pick a gate: default to `requireStaffSession` (any staff) only
  when the surface is genuinely operating-crew work; anything touching money, legal text, roster
  deletion, or trip definition picks the matching predicate here.
