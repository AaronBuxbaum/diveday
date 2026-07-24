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
| Trip configuration (create/edit/cancel, requirements, crew) | `canConfigureTrips` | owner, manager, instructor |

Trip configuration opens to instructors because course sessions and their admission rules are
instructor-owned work; the other four stay owner/manager because they are money, a legal document,
or an irreversible-feeling roster change. Captains, crew, and divemasters keep every *operating*
surface — the roster, check-in, manifest, roll call, gear packing, readiness — which none of these
predicates touch.

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
