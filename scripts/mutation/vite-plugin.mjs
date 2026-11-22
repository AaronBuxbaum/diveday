import { readFileSync } from "node:fs";
import path from "node:path";

/**
 * The switch that turns one mutant on (ADR 20261122-diff-mutation-testing).
 *
 * The runner starts one Vitest process per mutant and names the mutant in that child's
 * environment only: `DIVEDAY_MUTANT_FILE` is the absolute path of the source file under test,
 * `DIVEDAY_MUTANT_SOURCE` the absolute path of a file holding its already-mutated text. When
 * Vite loads the target module this hands it the mutated text instead of the file on disk, so
 * the tree never changes, mutants run side by side, and a crash leaves nothing to clean up.
 * With neither variable set (the baseline run) it does nothing.
 */
export function mutationPlugin(env = process.env) {
  const target = env.DIVEDAY_MUTANT_FILE ? path.resolve(env.DIVEDAY_MUTANT_FILE) : null;
  const sourcePath = env.DIVEDAY_MUTANT_SOURCE ?? null;
  let mutated = null;
  return {
    name: "diveday-mutation",
    enforce: "pre",
    load(id) {
      if (!target || !sourcePath) return null;
      const file = id.split("?")[0];
      if (path.resolve(file) !== target) return null;
      mutated ??= readFileSync(sourcePath, "utf8");
      return mutated;
    },
  };
}
