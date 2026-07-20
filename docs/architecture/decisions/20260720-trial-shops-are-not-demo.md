# 20260720-trial-shops-are-not-demo — Separate seeding sample data from demo mode

- **Status:** Accepted
- **Date:** 2026-07-20

Revises the `isDemo` decision of
[20260718-dynamic-demo-onboarding](20260718-dynamic-demo-onboarding.md); the onboarding flow and
path-prefixed multi-tenant routing from that ADR still stand.

## Context

[20260718-dynamic-demo-onboarding](20260718-dynamic-demo-onboarding.md) gave a newly onboarded shop
`isDemo: true` whenever the visitor left the "Seed with demo data" box checked. That conflated two
independent things: **seeding sample trips** (a convenience) and **demo mode** (a throwaway
playground). A real prospective owner who kept the default checkbox got the "Demo Playground" banner
and, worse, a destructive "Reset demo data" button over their own shop. The demo role-switcher also
resolved instructor/divemaster/captain by hardcoded Blue Mantis seed emails, so on any other
`isDemo` shop those switches failed with `?error=switch_failed`.

## Decision

- Onboarding a shop always sets `isDemo: false`. The "Seed with demo data" checkbox controls
  seeding only. `isDemo: true` is reserved for the canonical seeded demo tenant created by
  `seedIfEmpty` (`src/db/seed.ts`) and entered via `enterDemoAction` — today, Blue Mantis.
- The demo role-switcher (`src/app/actions/demo.ts`) resolves each target person by their role
  **within the current shop**, not by hardcoded email, and no-ops back to the shop if no seeded
  person holds that role. The Demo Playground banner hides role cards whose role has no seeded
  person in the shop.

## Alternatives considered

- **Keep `isDemo` tied to the seed checkbox** — simplest, but leaves a trial owner with a demo
  banner and a one-click data-wipe over real data.
- **A separate `seededSample` flag distinct from `isDemo`** — more expressive, but nothing needs to
  branch on "was seeded" today; the booking/trip data speaks for itself. Add it only if a real
  consumer appears.

## Consequences

Trials look and behave like real shops; only the canonical demo tenant shows the playground framing
and reset. Role-switching works on any `isDemo` shop and degrades gracefully. If self-serve demo
tenants beyond Blue Mantis are ever wanted, set `isDemo: true` on them explicitly — the role lookup
and banner already handle it. Revisit if "seeded but not demo" ever needs to be queryable, which
would justify the separate flag above.
