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

## Update 2026-10-07: the pair is pinned to an exact version again

Somewhere between this ADR and today both packages drifted from the exact `1.0.0-beta.22` pin to
the floating `rc` dist-tag, which the lockfile resolved to `1.0.0-rc.4`. A dist-tag moves whenever
Drizzle publishes, so the next `pnpm install` that refreshed the lock (or a fresh resolution in a
new checkout without one) could change the ORM and the migration CLI under the production migration
runner without any diff in `package.json` saying so. Both are now pinned to the exact version the
lockfile already resolved, `1.0.0-rc.4`, with no version change. An upgrade is a deliberate edit of
both pins together, followed by the full checks and a look at any regenerated migration, as the
Consequences above already ask.
