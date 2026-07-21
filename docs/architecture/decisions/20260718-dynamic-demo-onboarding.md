# 20260718-dynamic-demo-onboarding — Use dynamic shop onboarding and path-prefixed routing for multi-tenant trials

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

Previously, demo mode was a global deployment-level flag (`DIVEDAY_DEMO`) that forced the entire instance into a single, shared demo shop (`blue-mantis`). This prevented showing a demo alongside production operations on the same deployment and forced all visitors to share one example shop. We want to support self-serve trials where a prospective customer can dynamically create their own shop, optionally seeded with demo schedule data, without needing a dedicated demo deployment.

## Decision

- **Introduce shop onboarding at `/onboard`**: Any visitor can fill in the shop name, slug, timezone, and owner email/password. Submitting the form:
  - Dynamically registers the shop, owner person, roles, and credential account in a single transaction.
  - Automatically seeds the new shop with full demo schedules and data if "Seed with demo data" is selected, leveraging the existing parameterized `seedDemoSchedule`.
  - Signs the user in and redirects to the `/shop` staff dashboard.
- **Isolate trials via database-level `isDemo` column**: Rather than a deployment-level flag, the `shops` table carries `is_demo`. A trial shop gets `isDemo: true`, rendering the resettable `DemoBanner` at `/shop` layout and allowing resetting that specific tenant's schedule without impacting other shops.
  > Revised by [20260720-trial-shops-are-not-demo](20260720-trial-shops-are-not-demo.md): onboarded trials now get `isDemo: false`; `isDemo` is reserved for the canonical seeded demo tenant. The onboarding flow and routing below are unchanged.
- **Implement path-prefixed multi-tenant routing for customer surfaces**: Move public trips lists and details from `/trips/**` to `/shop/[shopSlug]/trips/**`. Public pages fetch the shop by its slug parameter to retrieve upcoming trips and execute bookings. Staff surfaces (`/shop/**`) remain dynamically tenant-isolated by the signed-in user's `session.user.shopId` inside the JWT session.

## Alternatives considered

- **Subdomain routing** — cleaner URL styling, but requires wildcard DNS and local `/etc/hosts` changes that complicate local development and automated e2e testing. Path-prefixed `/shop/[shopSlug]/` is self-contained.
- **Ephemerality via session memory** — avoids DB pollution, but breaks Next.js server actions and prevents linking customers or simulating multiple client bookings realistically.

## Consequences

- Prospective owners can try isolated trial shops on the main deployment.
- The global `DIVEDAY_DEMO` flag is no longer the sole way to access a demo environment.
- Trips routes `/trips` and `/trips/[id]` are moved to `/shop/[shopSlug]/trips` and `/shop/[shopSlug]/trips/[id]`.
