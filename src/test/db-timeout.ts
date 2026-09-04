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
 * `src/db/**` rather than "anything importing `src/test/db.ts`", because the
 * predicate has to answer from the path alone: it runs in the setup file,
 * before the test file's own imports are evaluated. That makes it a slight
 * over-reach — a handful of `src/db` files are pure — and an under-reach for
 * the db-backed tests that live beside their feature. Both are fine: this
 * raises a *ceiling*, so covering a file that never needed it costs nothing,
 * and a file it misses is exactly where it was before.
 */
export function needsDatabaseTimeout(testPath: string | undefined): boolean {
  return /[/\\]src[/\\]db[/\\]/.test(testPath ?? "");
}
