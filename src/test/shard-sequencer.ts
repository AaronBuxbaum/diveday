import { readFileSync } from "node:fs";
import path from "node:path";
import { BaseSequencer, type TestSpecification } from "vitest/node";

/**
 * Shards the unit suite by *cost* rather than by file count.
 *
 * Vitest's own `--shard` hashes each file's path and slices the sorted list
 * into equal-sized groups, so every shard gets the same number of files. The
 * files are nothing like the same size: a database-backed file hydrates an
 * embedded Postgres per test (~0.6-1.2s each, src/test/db.ts) while a pure
 * domain-logic file runs a hundred tests in the time one hydration takes, and
 * the 38 `src/db` files carried 849 of the 988 test-seconds in a measured
 * shard. Whichever shard draws the most of them finishes last, and the run
 * finishes when it does: on main the four unit shards spread from 4:08 to
 * 5:28 (2026-08-31), a minute and twenty seconds the fastest three spent idle.
 *
 * So each file is weighted by a static estimate — how many tests it declares,
 * times a per-test cost that depends on whether it hydrates a database — and
 * the files are dealt greedily, heaviest first, onto the least-loaded shard.
 * The estimate is deliberately crude: it reads the source, never runs it, so
 * every shard computes the identical partition from the same tree and no file
 * is run twice or not at all. Replayed against real durations from one shard
 * of 161 files, this packing put the four bins at 226-257s where a
 * round-robin deal put them at 176-326s.
 *
 * `sort` (the order within a shard) is inherited: Vitest still runs the
 * previously slowest files first when it has a cache, and this file's estimate
 * is only for the split.
 */

/** Modules whose import marks a file as hydrating a PGlite per test. */
const DB_HELPER_IMPORT =
  /from\s+["'](?:@\/test\/(?:db|postgres)|\.\.?\/(?:\.\.\/)*test\/(?:db|postgres))["']/;
/** The slow path taken directly, without the helper. */
const DB_FACTORY = /\bcreateTestDb\s*\(/;
/** One `it(`/`test(` per test, including `.each` tables (counted once — the
 *  table's row count is not worth parsing for). `describe` is not counted. */
const TEST_DECLARATION =
  /^\s*(?:it|test)(?:\.(?:each|skip|only|todo|skipIf|runIf|concurrent|for)(?:\([^)]*\))?)*\s*\(/gm;

/**
 * A **file-scoped** context (`fileScopedShopContext`, src/test/db.ts) hydrates
 * one PGlite for the whole file and gives each test a transaction that is
 * rolled back. `DB_HELPER_IMPORT` cannot see the difference — both helpers are
 * exported from `@/test/db` — so before this was split out, such a file was
 * billed a full hydration per test and the estimate came out roughly 20x its
 * real cost (issue #1302).
 *
 * That is not a harmless over-estimate. `partition` deals heaviest-first onto
 * the emptiest bin, and with the usual `count = 4` the four heaviest files each
 * seed a distinct bin — so an over-billed file *seeds a shard*, claims a bin's
 * budget it never spends, and the packer then fills that bin with real work
 * believing it balanced. `today.test.ts` seeded bin 4 deterministically, which
 * is the shard that timed out on `1237cbf` and again on `8c66fa5`.
 *
 * A call, not an import: a file may import both helpers and use only one.
 * Comments are stripped first, because `today.test.ts` names
 * `seededShopContext()` in the prose explaining why it stopped using it — the
 * same discipline `TEST_DECLARATION` needs for `// it("not a test")`.
 */
const FILE_SCOPED_CALL = /\bfileScopedShopContext\s*\(/;
/**
 * Per-test hydration, taken **directly**. A file matching this pays a database
 * per test whatever else it does, so a file using both helpers — `divers.test.ts`
 * does, file-scoped at the top and one `seededShopContext()` deep in a test —
 * falls back to the expensive branch rather than being billed as if the cheap
 * half were the whole story.
 */
const PER_TEST_HYDRATION_CALL =
  /\b(?:seededShopContext|seededTestDb|unseededTestDb|createTestDb)\s*\(/;
/** A line whose first non-space character opens or continues a comment. */
const COMMENT_LINE = /^\s*(?:\/\/|\/\*|\*)/;

/** Per-test cost, in arbitrary units that only have to be right relative to each other. */
export const PER_TEST_DB_COST = 1200;
/**
 * A rolled-back transaction, not a hydration. Measured against
 * `PER_TEST_DB_COST`'s own reference on two paired runs: `trips-queries` at
 * 49-113 equivalent units per test and `today` at 286-382, so 300 sits at the
 * top of the range. Deliberately the top rather than the middle — over-billing
 * deals a file *earlier*, onto an emptier bin, which is the safe direction;
 * under-billing deals it last onto a full one, which is the failure this
 * constant exists to avoid. Reusing `PER_TEST_PLAIN_COST` (60) would do exactly
 * that, at 2-6x under.
 */
export const PER_TEST_FILE_SCOPED_DB_COST = 300;
export const PER_TEST_PLAIN_COST = 60;
/**
 * Per-file overhead: process spawn, transform, imports.
 *
 * Raised from 1500 with the file-scoped split, because 1500 under-modelled it
 * about sixfold — `trips-queries` spends ~11s wall on ~2s of tests, most of it
 * transform and import. That was harmless while every database file paid the
 * same understated constant: a uniform error moves no file past another. It
 * stops being harmless the moment two database branches exist, so this is the
 * honest figure and **both** branches pay it.
 *
 * Raising it only for the file-scoped branch was tried first and is wrong: it
 * puts the crossover at about eight tests, below which a file-scoped file is
 * billed *more* than a per-test file of the same size — the packer wrong in a
 * new place, which is what the split was for.
 */
export const PER_FILE_DB_COST = 9000;
/**
 * The same overhead, plus the single hydration a file-scoped file pays up front
 * — which is exactly one test's worth at the per-test rate. Expressed as that
 * sum rather than as a number, because that is what it is.
 */
export const PER_FILE_FILE_SCOPED_DB_COST = PER_FILE_DB_COST + PER_TEST_DB_COST;
export const PER_FILE_PLAIN_COST = 800;

/** A static cost estimate for one test file's source. */
export function estimateCost(source: string): number {
  const tests = source.match(TEST_DECLARATION)?.length ?? 0;
  const db = DB_HELPER_IMPORT.test(source) || DB_FACTORY.test(source);
  if (!db) return PER_FILE_PLAIN_COST + tests * PER_TEST_PLAIN_COST;
  const code = source
    .split("\n")
    .filter((line) => !COMMENT_LINE.test(line))
    .join("\n");
  return FILE_SCOPED_CALL.test(code) && !PER_TEST_HYDRATION_CALL.test(code)
    ? PER_FILE_FILE_SCOPED_DB_COST + tests * PER_TEST_FILE_SCOPED_DB_COST
    : PER_FILE_DB_COST + tests * PER_TEST_DB_COST;
}

/**
 * Deals `items` onto `count` bins, heaviest first onto the emptiest bin, and
 * returns the bin numbered `index` (1-based, as Vitest numbers shards).
 *
 * Deterministic for a given input order: ties on weight keep the caller's
 * order, ties on load go to the lowest-numbered bin. The caller sorts by a
 * stable key first so every shard sees the same sequence.
 */
export function partition<T>(
  items: readonly { item: T; weight: number }[],
  index: number,
  count: number,
): T[] {
  const bins = Array.from({ length: count }, () => ({ load: 0, items: [] as T[] }));
  const byWeight = items
    .map((entry, order) => ({ ...entry, order }))
    .sort((a, b) => b.weight - a.weight || a.order - b.order);
  for (const { item, weight } of byWeight) {
    let lightest = bins[0];
    for (const bin of bins) if (bin.load < lightest.load) lightest = bin;
    lightest.load += weight;
    lightest.items.push(item);
  }
  return bins[index - 1].items;
}

export class CostWeightedSequencer extends BaseSequencer {
  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { config } = this.ctx;
    const { index, count } = config.shard ?? { index: 1, count: 1 };
    const weighted = [...files]
      .map((spec) => ({
        spec,
        key: path.relative(config.root, spec.moduleId).split(path.sep).join("/"),
      }))
      .sort((a, b) => (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
      .map(({ spec }) => ({ item: spec, weight: estimateCost(readSource(spec.moduleId)) }));
    return partition(weighted, index, count);
  }
}

function readSource(file: string): string {
  try {
    return readFileSync(file, "utf8");
  } catch {
    // A file that cannot be read still has to land in exactly one shard; give
    // it the plain per-file weight and let the run report the real error.
    return "";
  }
}
