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
    // Vitest 4 defaults to the "forks" pool: one child process per test file,
    // each repaying Node's full startup and re-importing the whole module
    // graph (Next, Drizzle, PGlite's WASM) from scratch. "threads" reuses one
    // process across files instead — per-file isolation is unaffected
    // (`isolate` still gives every file a fresh module registry/vm context;
    // that guarantee is orthogonal to the pool) — and measured a repeatable
    // ~13% faster full-suite run locally (~218s -> ~190s wall clock, three
    // clean runs, same 1449/1449 passing). Revisit only if PGlite ever shows a
    // worker_threads-specific failure; none has surfaced in this repo's use.
    pool: "threads",
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
