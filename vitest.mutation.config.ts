import { mergeConfig } from "vitest/config";
import { mutationPlugin } from "./scripts/mutation/vite-plugin.mjs";
import base from "./vitest.config";

/**
 * The repository's Vitest config with one mutant switched on, for `scripts/mutation/run.mjs`
 * (ADR 20261122-diff-mutation-testing). Everything the suite needs (projects, the PGlite global
 * setup, the frozen clock, the `@/` alias) comes from `vitest.config.ts`; this adds the switch
 * and makes a run as short as it can be: first failure stops it, no coverage, no output.
 *
 * The `mutation-fixtures` project holds the kill test's tiny modules
 * (scripts/mutation/fixtures/); the ordinary suite never matches them.
 */
export default mergeConfig(base, {
  plugins: [mutationPlugin()],
  test: {
    // Vitest 5 persists transformed modules under node_modules/.vitest-cache, keyed by the file
    // on disk, not by what a plugin loaded. Left on, a mutant run was served the unmutated module
    // (every mutant survived: the symptom of the Stryker trial, ADR 20261101), and a mutated
    // module was written back for the next unmutated run to read (measured 2026-11-22).
    fsModuleCache: false,
    coverage: { enabled: false },
    reporters: ["dot"],
    bail: 1,
    silent: true,
    projects: [
      {
        extends: true,
        test: { name: "mutation-fixtures", include: ["scripts/mutation/fixtures/**/*.test.ts"] },
      },
    ],
  },
});
