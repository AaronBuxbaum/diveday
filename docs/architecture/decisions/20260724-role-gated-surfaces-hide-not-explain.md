# 20260724-role-gated-surfaces-hide-not-explain — Full-page owner/manager surfaces disappear instead of explaining themselves

- **Status:** Accepted
- **Date:** 2026-07-24
- **Supersedes:** [20260724-role-authorization](20260724-role-authorization.md) (presentation contract only — the five predicates, live-role re-check, and both-layer enforcement that ADR establishes are unchanged)

## Context

[20260724-role-authorization](20260724-role-authorization.md) drew real boundaries on five staff
surfaces and, for the four that are their own standalone page — waivers, reports, data export,
contact import — had a denied staff member land on the page anyway and see a warning `ShopNotice`
explaining why the controls were missing (for waivers, a full read-only copy of the legal release
text). The product owner flagged this as backwards: a captain has no operational use for the
shop's waiver text, this month's revenue, a roster CSV, or the full-shop export, so showing (or
explaining the absence of) any of it is pure noise, not a courtesy. The nav, keyboard "go to"
shortcuts, and command palette still offered a path to each page regardless of role, so the notice
was reachable by anyone who took the link — a role-based feature-visibility gap, not just a wording
one.

## Decision

For the four surfaces gated entirely behind `canManageWaiverTemplates` / `canViewShopReports` /
`canExportShopData` / `canImportShopData` (`src/lib/authz.ts`), a denied staff member never reaches
the page's content at all:

- `ShopNavLinks` (the "More" menu), `KeyboardShortcuts`' `g`-then-key list, and `CommandPalette`'s
  "Go to" group each take the viewer's role (computed once in `src/app/shop/[shopSlug]/layout.tsx`
  via the same pure `src/lib/authz.ts` predicates, no extra query) and omit the entry outright —
  see `ShopNavGates` in `src/components/ShopNavLinks.tsx`.
- The page itself still re-checks the live, database-read role (`canPersonManageWaiverTemplates` et
  al. in `src/db/`) as the actual authority, exactly as before — only the failure branch changed,
  from rendering a `ShopNotice` in place of the controls to `redirect()` to the shop's Today page.
  Server actions that mutate these surfaces (`saveWaiverAction`, `chooseJurisdictionAction`) do the
  same on their race-condition backstop (a role revoked between page load and submit).

This is narrower than it sounds: the *other* pattern this codebase already used for role-denied
controls — hide the control, leave the rest of a shared page intact, optionally note why next to
it (payment settings' Stripe/rental section, the refund button, diver deletion, trip definition) —
is untouched. Those are one control on a page multiple roles legitimately use for other things;
hiding the whole page would hide the parts a crew member does need. The four surfaces here are
different: the entire page is one owner/manager-only concern, so there's nothing left once the
gated part is removed, and the honest move is for the surface not to exist for that viewer.

## Alternatives considered

- **Keep the notice, just tighten the copy.** Rejected — the product owner's objection wasn't the
  wording, it was that a role with no use for the data got a whole page (and, for waivers, the
  actual legal text) rendered at them at all.
- **404 instead of redirect.** A `notFound()` reads as "this route doesn't exist," which is false —
  it exists for other roles at this exact shop. A same-shop redirect to Today is honest without
  implying a broken link.
- **Hide only the nav/shortcuts/palette entries, leave the page's notice as a backstop for direct
  URL visits.** Rejected — a stale bookmark or a shared link would still show the notice (or the
  read-only waiver text), which is the exact leak this decision closes. The redirect is what makes
  the page-level check load-bearing rather than routing hidden nav.

## Consequences

- Bookmarked or shared links to these four pages now bounce a denied viewer to Today instead of
  showing a diagnostic message; e2e assertions in `e2e/role-permissions.spec.ts`,
  `e2e/import.spec.ts`, `e2e/export.spec.ts`, and `e2e/reports.spec.ts` check the redirect, not
  notice text.
- A new owner/manager-only full-page surface should follow this pattern (nav/shortcut/palette gate
  + page-level redirect on denial), not the older notice-in-place-of-page shape.
- Escape hatch: if a future full-page surface needs to explain *why* a role can't act (not just
  hide that it exists — e.g. a denied action a role should know to escalate), that is the older
  hide-the-control-with-a-note pattern from 20260724-role-authorization, still valid for controls
  embedded in a page other roles use. Revisit this ADR only if a full-page surface needs that same
  "tell them, don't just hide it" treatment.
