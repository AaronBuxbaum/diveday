import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { TEST_FROZEN_CLOCK } from "./src/test/frozen-clock";

export default defineConfig({
  plugins: [react()],
  test: {
    // Node is the default; the few component tests that need a DOM opt in with
    // a `// @vitest-environment jsdom` docblock. Booting jsdom for every pure
    // domain-logic file was measurable dead weight.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    // Builds the shared PGlite template snapshot the db tests hydrate from.
    globalSetup: ["./src/test/global-setup.ts"],
    // `scripts/` is in scope too: a few repo scripts carry real parsing and
    // formatting logic that nothing else would exercise (scripts/visual-report-lib.mjs
    // decides whether a reg-suit run compared anything at all), and they belong
    // in the same `pnpm check` gate as the app.
    // `infra/` too: the CDK stack is the only place a credential can leak into a
    // stack output, and nothing else in `pnpm check` synthesizes it — lint and
    // tsc see TypeScript, not a CloudFormation template.
    include: ["src/**/*.test.{ts,tsx}", "scripts/**/*.test.mjs", "infra/**/*.test.ts"],
    // PGlite-backed integration tests hydrate an embedded Postgres per test;
    // generous ceiling so slow CI runners don't flake.
    testTimeout: 20_000,
    // Vitest 4's default. This ran on `pool: "threads"` for a while (~13%
    // faster full suite locally — worker_threads reuse one process instead of
    // repaying Node startup per fork), with a written caveat to revisit if
    // PGlite ever showed a worker_threads-specific failure. One surfaced on
    // 2026-08-20: a CI unit shard died mid-run with a V8 fatal —
    // `Check failed: jit_page_->allocations_.erase(addr) == 1` in
    // `ThreadIsolation::UnregisterWasmAllocation`, SIGILL — the known V8 race
    // in cross-thread WASM JIT-page bookkeeping, on the shard where every
    // PGlite instance loads two WASM extensions (pg_trgm + btree_gist). The
    // same shard passed locally and on re-runs; it is a probabilistic crash,
    // not a failing test. Forks give each worker its own V8, which removes
    // the cross-thread race entirely and contains any future WASM crash to
    // one worker instead of killing the whole run. Don't switch back to
    // "threads" while the suite runs WASM Postgres in workers.
    pool: "forks",
    // `pnpm test:changed` (and `vitest related`) selects tests by walking the
    // *import* graph, and the Drizzle migrations are never imported — they are
    // read off disk at runtime by `migrate(db, { migrationsFolder: "drizzle" })`.
    // A migration change therefore selected zero tests while silently changing
    // the schema every db-backed test runs against. Listing it here makes any
    // `drizzle/` edit rerun the whole suite. Setting this option *replaces*
    // Vitest's defaults rather than extending them, so the first three entries
    // restate those defaults verbatim and must stay.
    forceRerunTriggers: [
      "**/package.json/**",
      "**/vitest.config.*/**",
      "**/vite.config.*/**",
      "**/drizzle/**",
    ],
    // Freezes `nowDate()` (src/lib/clock.ts) for test-worker processes; see
    // src/test/frozen-clock.ts for why global-setup.ts also sets this
    // directly rather than relying on this config alone.
    env: {
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      // Set-but-empty is this repo's "off" switch (src/lib/configured.ts), and
      // the DSN needs one now that it is compiled in rather than supplied by
      // the environment: `register()` is called directly by
      // instrumentation.test.ts, so without this the unit suite initializes
      // real Sentry and reports its own deliberate failures to the production
      // project. `pnpm e2e:build` switches it off the same way.
      NEXT_PUBLIC_SENTRY_DSN: "",
      DIVEDAY_CLOCK: TEST_FROZEN_CLOCK,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
