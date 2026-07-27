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
    include: ["src/**/*.test.{ts,tsx}"],
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
    // Freezes `nowDate()` (src/lib/clock.ts) for test-worker processes; see
    // src/test/frozen-clock.ts for why global-setup.ts also sets this
    // directly rather than relying on this config alone.
    env: {
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      DIVEDAY_CLOCK: TEST_FROZEN_CLOCK,
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
