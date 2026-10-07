import { globSync, readFileSync } from "node:fs";
import path from "node:path";

/**
 * **Which Vitest project a test file runs in** (vitest.config.ts).
 *
 * One config used to run every file the same way: a fresh fork per file, the
 * PGlite global setup, the database timeout probe. That is the right price for
 * a file that hydrates a database and far too much for the 280 pure `src/lib`
 * files, which spend more time booting a fork and re-importing their modules
 * than running their tests. Splitting by *what a file needs* lets each kind pay
 * only its own way:
 *
 * - **`db`** — imports the database fixture (`@/test/db`, `@/test/postgres`,
 *   `@/test/query-count`) or builds a database directly. Forks, isolated, and
 *   the only project that runs the PGlite global setup.
 * - **`ui`** — opts into jsdom with a `// @vitest-environment jsdom` docblock.
 *   The docblock stays the switch; the project just groups the files that pay
 *   the jsdom boot so `pnpm test:ui` can run them alone.
 * - **`lib`** — pure `src/lib` logic with no module mocks. `isolate: false`:
 *   the files share a worker and its module cache. A file that calls
 *   `vi.mock` and friends is excluded, because a mock is per file and a shared
 *   registry would hand the next file the previous one's fake.
 * - **`scripts`** — `scripts/**` tests of the repository's own tooling.
 * - **`node`** — everything else: route handlers, server actions, i18n,
 *   features, infra, and the `src/lib` files `lib` excludes. Isolated forks, as
 *   before.
 *
 * The split is by **reading the source**, the same way the shard sequencer and
 * `needsDatabaseTimeout` decide (src/test/shard-sequencer.ts,
 * src/test/db-timeout.ts), because "imports the database fixture" is not a path
 * a glob can express. It runs once per Vitest start over the files the root
 * `include` matches, and every matched file lands in exactly one project
 * (`projects.test.ts` pins that).
 */
export type ProjectName = "db" | "ui" | "lib" | "scripts" | "node";

export const PROJECT_NAMES: readonly ProjectName[] = ["db", "ui", "lib", "scripts", "node"];

/** The root `include`: every test file in the repository. */
export const TEST_GLOBS = [
  "src/**/*.test.{ts,tsx}",
  "scripts/**/*.test.mjs",
  "infra/**/*.test.ts",
] as const;

/** A direct import of a module that hydrates a PGlite. */
const DB_IMPORT =
  /from\s+["'](?:@\/test\/(?:db|postgres|query-count)|\.\.?\/(?:\.\.\/)*(?:test\/)?(?:db|postgres|query-count))["']/;
/** The slow path taken directly, without the helper. */
const DB_FACTORY = /\b(?:createTestDb|seededTestDb|unseededTestDb)\s*\(/;
/** The jsdom opt-in. Only a docblock counts, the way Vitest reads it. */
const JSDOM_DOCBLOCK = /^\s*(?:\/\/|\/?\*+)\s*@vitest-environment\s+jsdom\b/m;
/** Anything that makes a file's module registry its own business. */
const MODULE_STATE =
  /\bvi\.(?:mock|doMock|unmock|doUnmock|resetModules|importActual|importMock|stubGlobal|stubEnv)\s*\(/;
/** The project one test file belongs to, from its repo-relative path and source. */
export function classifyTestFile(file: string, source: string): ProjectName {
  const posix = file.split(path.sep).join("/");
  if (posix.startsWith("scripts/")) return "scripts";
  if (DB_IMPORT.test(source) || DB_FACTORY.test(source)) return "db";
  if (JSDOM_DOCBLOCK.test(source)) return "ui";
  if (posix.startsWith("src/lib/") && !MODULE_STATE.test(source)) return "lib";
  return "node";
}

/**
 * Every test file under `root`, grouped by project. Paths are repo-relative
 * POSIX, sorted, and each appears in exactly one group.
 */
export function partitionTestFiles(root: string): Record<ProjectName, string[]> {
  const groups = Object.fromEntries(PROJECT_NAMES.map((name) => [name, [] as string[]])) as Record<
    ProjectName,
    string[]
  >;
  const files = new Set<string>();
  for (const glob of TEST_GLOBS) {
    for (const file of globSync(glob, { cwd: root, exclude: (f) => f.includes("node_modules") })) {
      files.add(file.split(path.sep).join("/"));
    }
  }
  for (const file of [...files].sort()) {
    let source = "";
    try {
      source = readFileSync(path.join(root, file), "utf8");
    } catch {
      // Unreadable still has to run somewhere; `node` is the plain default.
    }
    groups[classifyTestFile(file, source)].push(file);
  }
  return groups;
}

/**
 * A repo-relative path as a glob that matches only itself. Route folders are
 * full of glob syntax — `[shopSlug]` is a character class to a glob — so every
 * metacharacter is escaped.
 */
export function literalGlob(file: string): string {
  return file.replace(/[\\[\]{}()*?!+@]/g, (char) => `\\${char}`);
}
