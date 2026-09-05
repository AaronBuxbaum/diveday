import type { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import type { AppDb } from "@/db/client";
import { seededShopContext } from "./db";

/**
 * How many statements a reader actually sends, so an N+1 fails a test instead
 * of a Saturday.
 *
 * ## Why this exists
 *
 * Nothing in this repository measured query counts before. That is a gap with
 * a known shape: the cost of a per-row round trip does not show up as a wrong
 * answer, a type error or a red assertion — it shows up as latency that grows
 * with a shop's data, on exactly the surfaces that matter most (the home
 * spine, the manifest, a paged list), long after the change that caused it.
 * This app has already paid the same class of bill once: `Intl` formatters
 * constructed per render cost ~12x reusing them and surfaced as *e2e flake
 * under load*, which is the most expensive possible way to learn about a
 * per-iteration cost. `pnpm check:intl-cache` now refuses that one statically.
 * A query in a loop cannot be caught by a grep, so it is caught by counting.
 *
 * ## What to assert, and what not to
 *
 * Prefer **invariance** over a number: run the reader over one row, then over
 * several, and assert the count did not move ({@link expectQueryCountInvariant}).
 * That is the property an N+1 actually violates, and it stays true as the demo
 * fixture grows — where an absolute budget would need re-banking every time
 * somebody adds a departure to the seed, and would be re-banked without much
 * thought, which is how a ratchet stops meaning anything.
 *
 * A fixed ceiling still earns its place on a reader whose fan-out is fixed by
 * construction (the home spine reads a bounded window, not a page of rows).
 * There it is not catching a loop; it is catching a query someone added to an
 * assembly path that already makes twenty.
 *
 * ## What it counts
 *
 * Statements drizzle sends, via the driver's own `logger` hook — so a
 * `queryAll` fan-out counts as the several statements it is, `select().from()`
 * with four joins counts as one, and `BEGIN`/`COMMIT` are counted too, because
 * a reader that opens a transaction it does not need is worth seeing.
 *
 * The handle is a second drizzle instance over the *same* PGlite client, which
 * is one connection: queries through it run against the same database and, if
 * one is open, inside the same transaction. It is a different view of one
 * connection, not a second one.
 */
export type QueryLog = {
  /** The handle to pass to the reader under test. */
  db: AppDb;
  /** SQL text of every statement sent since the last {@link QueryLog.reset}. */
  readonly statements: readonly string[];
  /** How many statements that is. */
  count(): number;
  /** Forget everything so far — call it between the arrange and the act. */
  reset(): void;
};

/** Wrap an existing database so statements sent through the returned handle are recorded. */
export function countQueries(db: AppDb): QueryLog {
  const statements: string[] = [];
  const counted = drizzle({
    client: db.$client as PGlite,
    logger: {
      logQuery: (query: string) => {
        statements.push(query);
      },
    },
  }) as unknown as AppDb;

  return {
    db: counted,
    statements,
    count: () => statements.length,
    reset: () => {
      statements.length = 0;
    },
  };
}

/** {@link seededShopContext} with its database already wrapped for counting. */
export async function countingShopContext(options: { history?: boolean } = {}) {
  const { db, shop } = await seededShopContext(options);
  return { ...countQueries(db), shop, uncounted: db };
}

/**
 * Run `read` over each input size in turn and hand back what each one cost.
 *
 * Sizes rather than a single before/after because two points cannot tell a
 * genuine fan-out from a one-off: a reader that sends `2, 3` might be N+1, or
 * might have taken one different branch. `1, 2, 4` separates them — a loop
 * grows with every step, and nothing else does.
 */
export async function queryCountsBySize<T>(
  log: QueryLog,
  sizes: readonly number[],
  read: (size: number) => Promise<T>,
): Promise<number[]> {
  const counts: number[] = [];
  for (const size of sizes) {
    log.reset();
    await read(size);
    counts.push(log.count());
  }
  return counts;
}

/**
 * Assert a reader's cost does not grow with how much it is asked for.
 *
 * The failure message carries the counts and the sizes, because "expected 7 to
 * be 5" tells the next reader nothing about what it is looking at, and the
 * shape of the growth (`5, 6, 8` for one query per row; `5, 9, 17` for two) is
 * most of the diagnosis.
 */
export async function expectQueryCountInvariant<T>(
  log: QueryLog,
  sizes: readonly number[],
  read: (size: number) => Promise<T>,
): Promise<number> {
  const counts = await queryCountsBySize(log, sizes, read);
  const [first] = counts;
  if (counts.some((count) => count !== first)) {
    throw new Error(
      `query count grows with input size — a per-row round trip.\n` +
        `  sizes:   ${sizes.join(", ")}\n` +
        `  queries: ${counts.join(", ")}\n` +
        `Read the last statements below; the repeated one is the loop.\n` +
        log.statements
          .slice(-5)
          .map((statement) => `  - ${statement.slice(0, 160)}`)
          .join("\n"),
    );
  }
  return first ?? 0;
}
