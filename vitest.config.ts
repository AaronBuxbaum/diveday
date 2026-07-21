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
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
});
