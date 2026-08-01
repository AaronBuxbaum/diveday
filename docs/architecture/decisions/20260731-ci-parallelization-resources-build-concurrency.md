# 20260731-ci-parallelization-resources-build-concurrency — Cap build concurrency only when PGlite is file-backed

- **Status:** Accepted
- **Date:** 2026-07-31

## Context

`next.config.ts` unconditionally set `experimental.cpus: 1` and
`staticGenerationMaxConcurrency: 1`, printed on every `next build`/`next dev` as an "Experiments
(use with caution)" line. The comment explained the real constraint: with no `DATABASE_URL`,
`getDb()` (`src/db/client.ts`) falls back to PGlite, an embedded single-connection database, and
concurrent static-generation workers writing/reading the same file-backed data directory would
corrupt it.

That reasoning only holds for the file-backed case. Two builds that never hit it were paying the
cap anyway:

- **Production/preview builds** (`scripts/vercel-build.mjs` → `pnpm build`) run with a real
  `DATABASE_URL` — a pooled Postgres connection built for concurrent callers, with an advisory
  lock already guarding concurrent cold-start seeding (`src/db/client.ts`'s `SEED_LOCK_KEY`).
- **CI's `e2e:build`** (the only `next build` CI runs, per `.github/workflows/ci.yml`'s `build`
  job) force-unsets `DATABASE_URL` to guarantee PGlite, but used a shared file-backed
  `.pglite-e2e` directory even though nothing downstream reads it after the build (only `.next/`
  is uploaded as an artifact) — there was no reason for it to be file-backed at all.

`ADR 20260720-e2e-parallel-prod-fleet.md` already solved the identical problem one layer up: the
Playwright/visual runtime fleet runs one `next start` server per worker, each with its own
`PGLITE_DATA_DIR=memory` database, so per-process in-memory PGlite is already a proven, pixel-stable
isolation pattern in this codebase. The seed is fully deterministic (clock-anchored via
`src/lib/clock.ts`, fixed IDs), so independent in-memory instances render identical content.

## Decision

Extend that same per-process isolation to the build step and cap concurrency only when it's
actually needed:

- `e2e:build` now sets `PGLITE_DATA_DIR=memory` instead of `.pglite-e2e`. Every static-generation
  worker process gets its own private, deterministically-seeded in-memory database — no shared
  file, no contention.
- `next.config.ts` only forces `cpus: 1` / `staticGenerationMaxConcurrency: 1` when
  `!process.env.DATABASE_URL && process.env.PGLITE_DATA_DIR !== "memory"` — i.e., only the
  local-dev fallback (no `.env.local`, file-backed `.pglite` that deliberately persists across
  `pnpm dev` restarts via `pnpm db:reset`). Production/preview builds and `e2e:build` now use
  Next's own default worker count.

The `build` CI job never launches a browser (Chromium only runs in the separate `playwright`/
`visual` jobs), so there is no "reserve cores for the browser" tradeoff here — the runner's full
core count (`ubuntu-latest`: 4-core AMD EPYC 9V45, per `20260730-linux-ci-runners.md`) is available
to static-generation workers.

Separately, `e2e/servers.ts`'s `defaultWorkers` (how many `playwright`/`visual` worker
servers — each a browser *and* a `next start` process — to run) computed `floor(cpus / 4)`, despite
its own comment stating a "~2 cores per worker" budget (`floor(cpus / 2)`). The doubled-up divisor
traced to a real finding in `20260720-e2e-parallel-prod-fleet.md`: 2 workers on a 4-core CI runner
(4 heavy processes) blew assertion timeouts under contention. That finding predates this repo's
move from 3-core macOS to real 4-core/16GB Linux CI runners and was never revisited after. A CI run
on the current hardware confirmed 2 workers (matching the comment's stated budget) run clean with no
contention, so `defaultWorkers` now divides by 2 to match — no env var override needed for CI to
get the correct worker count on today's runners.

## Alternatives considered

- **Unique file-backed `PGLITE_DATA_DIR` per worker** (e.g. keyed by a worker index) — works in
  principle but Next doesn't expose a stable per-worker identifier to `next.config.ts`/build-time
  code the way `playwright.config.ts` can assign one per `next start` invocation; `memory` mode
  is already isolated by construction (separate process, separate WASM linear memory) and needs
  no such plumbing.
- **Give CI's build step a real ephemeral Postgres service container**, matching production's
  path exactly — would remove the PGlite branch from CI entirely, but changes what `e2e:build`
  builds against and risks touching the seed/determinism guarantees the e2e and visual suites
  depend on (`20260719-msw-offline-sync-only.md`, `20260729-reg-suit-visual-regression.md`).
  Bigger, riskier change for a build step where most routes are dynamic (`ƒ`) rather than
  statically generated, so the concurrency win is smaller than it looks; not pursued here.

## Consequences

- Production/preview builds and `e2e:build` use Next's default worker scaling instead of being
  pinned to one core; only genuinely-unsafe local file-backed PGlite builds stay capped.
- `.pglite-e2e` is no longer created by `e2e:build`; its `.gitignore` entry is now inert and can
  be removed whenever that file is next touched.
- If a future change makes local dev's default PGlite path also safe for concurrent workers (e.g.
  switching its default to per-invocation isolation), the remaining cap could be dropped entirely
  — revisit then.
- `playwright`/`visual` CI jobs and local `pnpm e2e`/`pnpm visual` runs on comparable 4-core
  machines now run 2 e2e worker servers by default instead of 1, roughly halving wall-clock for
  that suite. If a future runner change reintroduces timeout-driven contention, `E2E_WORKERS`
  still overrides the default without editing code.
- **That override was exercised**, not just theorized: re-enabling `cacheComponents`
  (20260801-cache-components-e2e-activity-migration.md) added enough per-request Partial
  Prerendering render cost that the sharded `playwright` CI job's 2-workers-on-4-cores budget
  went from clean to contended again — assertion timeouts on a different spec each run, the same
  signature this ADR describes. The `playwright` job now sets `E2E_WORKERS: "1"` for its test
  step; the `visual` job (a single spec file, screenshot-dominated rather than
  interaction-dominated) showed no contention and was left at the default. Revisit this pin if a
  future `cacheComponents`-adjacent change shifts the render cost again, in either direction.
