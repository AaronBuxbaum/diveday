import path from "node:path";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
    env: {
      DATABASE_URL: "",
      DATABASE_URL_UNPOOLED: "",
      // Freeze src/lib/clock.ts's `nowDate()` for the whole unit-test process,
      // same instant and same reasoning as the e2e fleet (e2e/servers.ts):
      // the demo seed is clock-anchored ("sails today" departure, cert
      // expiries), so leaving it on the live clock lets the shared test-db
      // template (src/test/db-template.ts) and a test's own `nowDate()` calls
      // drift apart — most visibly right around local midnight in the shop's
      // timezone, where a trip seeded "today" can read as tomorrow or
      // yesterday depending on the exact second a test runs. A mid-morning
      // weekday in America/New_York keeps that departure comfortably in the
      // future no matter when in the day CI happens to run.
      DIVEDAY_CLOCK: "2026-07-21T13:30:00.000Z",
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
