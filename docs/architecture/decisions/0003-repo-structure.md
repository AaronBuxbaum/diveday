# 0003 — Keep a single app at the repo root (no monorepo yet)

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

Monorepo tooling (workspaces, Turborepo) adds indirection every agent pays on every task —
extra configs, cross-package plumbing, "where does this live" decisions — while we have exactly
one deployable.

## Decision

The Next.js app lives at the repository root. Shared logic is a directory (`src/lib/`), not a
package. `docs/`, `.claude/`, `e2e/`, and `scripts/` sit alongside `src/`.

## Alternatives considered

- **pnpm workspace + `apps/web` + `packages/*` now** — structure for a future that may not
  arrive, at a daily cost to every agent task.

## Consequences

- Simplest possible commands and imports; one `package.json`.
- Trigger to revisit: a second deployable (mobile app, worker service) or a package we publish.
  Migration is mechanical (move app into `apps/web`, hoist configs) and gets its own ADR.
