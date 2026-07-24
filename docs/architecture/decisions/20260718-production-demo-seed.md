# 20260718-production-demo-seed — Seed the demo shop in every environment

- **Status:** Superseded by [20260724-per-visitor-demo-shops](20260724-per-visitor-demo-shops.md)
- **Date:** 2026-07-18

## Context

The landing page promises a one-click live demo, but the production database adapter previously
did not run the demo seed. A fresh or empty Neon database therefore rendered a CTA whose action
could only return the visitor to the landing page. The demo tenant and its credentials are an
intentional product fixture, not optional development data.

## Decision

Run the existing `seedIfEmpty` bootstrap after both PGlite and Neon database initialization. The
seed creates the Blue Mantis demo shop, staff accounts, and resettable schedule before requests can
use the database. The application always assumes the seeded demo tenant exists; demo entry points
remain unconditional and are not guarded by a missing-tenant fallback.

## Alternatives considered

- **Hide or replace the CTA when no demo exists** — avoids the failure but breaks the product promise
  and masks an incomplete database bootstrap.
- **Provision the demo manually in each deployment** — fragile and easy to omit when a database is
  recreated.

## Consequences

Every environment carries a shared, writable demo tenant and its deterministic demo login, so the
demo must remain clearly marked and resettable. Production schema migrations still run out of band;
the bootstrap only seeds the known fixture. Revisit when the demo becomes per-visitor or when
production accounts must never share a seeded credential; that migration would need tenant
provisioning and a new demo-auth flow.
