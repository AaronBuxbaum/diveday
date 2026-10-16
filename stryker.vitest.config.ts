import { defineConfig } from "vitest/config";
import { literalGlob, partitionTestFiles } from "./src/test/projects";
import base from "./vitest.config";

/**
 * The config Stryker's vitest runner loads (stryker.config.mjs): the root config with one flat
 * project holding the `lib` group, the pure `src/lib` files. The runner forces the threads pool,
 * which is safe for pure files and not for the PGlite ones (vitest.config.ts, `pool`), and a
 * mutant in a pure module is judged by the tests that pin it, not by a database round trip.
 */
const groups = partitionTestFiles(__dirname);

export default defineConfig({
  ...base,
  test: {
    ...base.test,
    projects: undefined,
    sequence: undefined,
    coverage: undefined,
    include: groups.lib.map(literalGlob),
  },
});
