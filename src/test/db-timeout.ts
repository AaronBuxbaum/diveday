import { readFileSync } from "node:fs";

/**
 * **Which test files get a longer ceiling than the suite's own, and how long.**
 *
 * `testTimeout`/`hookTimeout` in `vitest.config.ts` are one number for the
 * whole suite, and 20s is generous for the pure-logic files that are most of
 * it. A db-backed test is a different animal: `seededShopContext()` hydrates a
 * PGlite template per call at 0.6–1.2s, and a file like `closeout.test.ts`
 * does it eight times because it cannot use `fileScopedShopContext` — it opens
 * its own transactions, it is a money path, and it asserts on the ordering of
 * `defaultNow()`-stamped rows, which one wrapping transaction would freeze
 * (`src/test/db.ts`'s "When NOT to use this"). On a contended CI runner that
 * lands over 20s, and it did on three separate runs across two shards, always
 * inside `seededShopContext()` on a test's first line and never on an
 * assertion (issue #1306).
 *
 * This is not widening a timeout to paper over a flake — the mechanism is
 * understood and the work is real. It is scoping the ceiling to the thing it
 * is a ceiling for: a hung pure-logic test still fails in 20s, and only the
 * files that talk to a database get the longer rope.
 *
 * Applied from `src/test/setup.ts`, which runs per test file and therefore
 * knows which one it is. A second Vitest project would be the framework's own
 * answer, and it would have to restate `globalSetup`, the cost-weighted
 * sequencer, the `forks` pool and the whole `env` block — four things whose
 * reasoning lives in one place today and would then live in two.
 */
export const DB_TEST_TIMEOUT_MS = 60_000;

/**
 * True for a test file that hydrates an embedded Postgres.
 *
 * Two rules, because the layer a file lives in answers most of it and not all
 * of it. `src/db/**` is the bulk, and it is a path test so it holds even when a
 * file reaches the fixture through a local helper. The second rule closes the
 * gap this docblock used to name as acceptable: **a db-backed test that lives
 * beside its feature.** `src/app/api/test/seed-evening/route.test.ts` hydrates
 * six times and is not under `src/db`, so it kept the 20s ceiling and timed out
 * on a contended runner — inside `seededShopContext()` on a test's first line,
 * the identical signature #1306 recorded.
 *
 * Reading the file settles it exactly. The original rationale for a path-only
 * answer was that this runs before the test file's own imports are evaluated —
 * true, and beside the point: the *source text* is on disk either way, and a
 * direct `from "@/test/db"` is what actually predicts the cost. One small
 * synchronous read per test file, against a per-file worker startup of ~292ms.
 *
 * A transitive import is not matched, and does not need to be: this raises a
 * *ceiling*, so a file it covers unnecessarily loses nothing and a file it
 * misses is exactly where it was before. Unreadable is false, for the same
 * reason — a predicate that threw would fail the run rather than the test.
 */
export function needsDatabaseTimeout(testPath: string | undefined): boolean {
  if (!testPath) return false;
  if (/[/\\]src[/\\]db[/\\]/.test(testPath)) return true;
  try {
    return IMPORTS_TEST_DB.test(readFileSync(testPath, "utf8"));
  } catch {
    return false;
  }
}

/** `@/test/db` from anywhere, or the relative spellings used inside `src/test`. */
const IMPORTS_TEST_DB = /\bfrom\s+["'](?:@\/test\/db|(?:\.{1,2}\/)+(?:test\/)?db)["']/;
