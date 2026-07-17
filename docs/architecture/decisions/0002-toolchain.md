# 0002 — Use pnpm, Biome, Vitest, and Playwright

- **Status:** Accepted
- **Date:** 2026-07-17

## Context

Agents run the toolchain hundreds of times per feature. Feedback speed and unambiguous
single-command workflows matter more than plugin ecosystems. Every check must be runnable
headlessly in sandboxes and CI.

## Decision

- **pnpm** — package manager (pinned via `packageManager` field).
- **Biome** — linting *and* formatting in one fast tool (`pnpm lint`, `pnpm lint:fix`).
  Recommended preset + Next/React/test domains, format-on-save-equivalent enforced in CI.
- **Vitest + Testing Library** — unit/component tests, jsdom, colocated `*.test.ts(x)`.
- **Playwright** — e2e in `e2e/`. Config honors `PLAYWRIGHT_CHROMIUM_EXECUTABLE` and
  auto-detects the sandbox Chromium at `/opt/pw-browsers/chromium`, so `pnpm e2e` works in
  agent sandboxes without a browser download.
- **`pnpm check`** — lint + typecheck + unit tests; the pre-commit bar.

## Alternatives considered

- **ESLint + Prettier** — larger ecosystem and more training data, but two tools, two configs,
  slower runs; Biome's one-tool loop wins for agent throughput.
- **Jest** — slower, worse ESM/TS story than Vitest.
- **Cypress** — heavier, weaker headless-sandbox story than Playwright.

## Consequences

- Fast, deterministic `pnpm check`; a single formatter ends style debates.
- Biome occasionally lags very new ESLint rules; acceptable.
- No git hooks by design — agents verify explicitly (see `engineering/workflow.md`), CI is the
  backstop. Revisit if unverified commits start reaching CI red.
