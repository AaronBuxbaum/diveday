# 20260718-drizzle-v1-beta — Use Drizzle v1 beta for migration diagnostics

- **Status:** Accepted
- **Date:** 2026-07-18

## Context

The production migration runner used Drizzle ORM 0.45.2 and Drizzle Kit 0.31.10. A PostgreSQL
migration failure returned exit code 1 while hiding the underlying database error, making a real
enum/data mismatch look like an infrastructure failure. Drizzle Kit v1.0.0-beta.22 includes the
fix for that reporting bug, but also requires its v1 migration-folder format.

## Decision

Pin `drizzle-orm` and `drizzle-kit` together at `1.0.0-beta.22`. Convert the committed migration
artifacts with `drizzle-kit up`, keep the converted SQL and snapshots in version control, and use
the existing `pnpm db:migrate` command for production migrations. Keep PGlite for local development
and tests; the ORM/CLI upgrade does not change the database provider or driver boundary from
[ADR-0005](0005-database.md) and [the Neon hosting ADR](20260718-vercel-neon-hosting.md).

## Alternatives considered

- **Stay on 0.45.2/0.31.10** — avoids v1 API and migration-format changes but preserves the silent failure mode.
- **Upgrade only Drizzle Kit** — risks ORM/CLI incompatibility; the v1 release is designed as a paired upgrade.
- **Use a custom migration wrapper** — adds project-owned maintenance for a bug fixed upstream.

## Consequences

Migration failures now expose the underlying database error, and the repository uses the v1 folder
layout that avoids the old shared journal file. The beta introduces breaking ORM and migration API
changes, so future upgrades must run the full repository checks and inspect generated migrations.
If the beta causes incompatibilities or a stable v1 release changes the APIs again, pin the last
known-good pair and migrate the folder format once more; reverting the package pins and restoring
the previous generated layout would be the main rollback cost.
