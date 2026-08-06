import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { Pool } from "pg";
import { describe, onTestFinished } from "vitest";
import type { AppDb } from "@/db/client";
import { withExplicitSslMode } from "@/db/connection-string";

/**
 * The seam that lets a handful of tests run against a **genuine Postgres
 * server** instead of PGlite.
 *
 * Everything else in this repo's db suite runs on PGlite via `@/test/db`, and
 * that is the right default: fast, hermetic, no service to stand up. But PGlite
 * is single-connection, so two transactions can never sit inside the same
 * critical section at once — which makes the `FOR UPDATE` guards the schema is
 * designed around (`createBookingRecord`'s oversell lock,
 * `withBookingPaymentLock`) structurally unexercisable there, and leaves the
 * committed `drizzle/` migrations first meeting a real server during the
 * production deploy. `src/db/money-replay.test.ts`'s header states the same
 * limitation from the other side; docs/engineering/testing.md records what the
 * CI job built on this proves and what it still does not.
 *
 * ## Opt-in, and quiet by default *only* because there is no server
 *
 * `DIVEDAY_TEST_POSTGRES_URL` is the whole switch. Unset — every local
 * `pnpm test`, every one of CI's four unit shards — and {@link describePostgres}
 * registers a skipped suite: no connection attempted, no service required, the
 * ordinary suite's runtime unchanged.
 *
 * A **separate** variable rather than `DATABASE_URL`, deliberately.
 * `DATABASE_URL` is what `getDb()` reads (src/db/client.ts), and both
 * `vitest.config.ts`'s `test.env` and `src/test/global-setup.ts` pin it to `""`
 * precisely so that no test can reach a real database by accident. Reusing it
 * would mean un-pinning that, and every unrelated test in the run would start
 * talking to whatever server CI happened to have up. One purpose-built variable
 * keeps the blast radius to the files that ask for it by name.
 *
 * ## One scratch database per test
 *
 * {@link postgresTestDb} creates a freshly-named database on the server for the
 * calling test, migrates it, and drops it when the test finishes. That is what
 * keeps these tests as isolated as their PGlite siblings despite sharing one
 * server — and what lets a race test open two *real* connections onto the same
 * rows without another test's data in the way.
 */

/** The server these tests run against, or `""` when none is configured. */
export const POSTGRES_TEST_URL = process.env.DIVEDAY_TEST_POSTGRES_URL ?? "";

/** Whether a real Postgres server was named for this run. */
export const hasRealPostgres = POSTGRES_TEST_URL.length > 0;

/**
 * `describe` for a real-Postgres suite: runs when `DIVEDAY_TEST_POSTGRES_URL`
 * names a server, skips cleanly when it does not.
 *
 * Named rather than spelled `describe.skipIf(...)` per file so the *reason*
 * travels with the suite, and so there is one place to change if the switch
 * ever moves.
 */
export const describePostgres = describe.skipIf(!hasRealPostgres);

/** Everything a real-Postgres test needs: its own database, and more ways into it. */
export type PostgresTestDatabase = {
  /** Drizzle over the first connection pool, typed as the app's own database. */
  db: AppDb;
  /** Connection string of this test's scratch database. */
  url: string;
  /**
   * A **second (third, …) independent** connection to the same scratch database.
   *
   * This is the point of the whole file. Two `AppDb` values handed out here are
   * backed by different `pg` pools, so a transaction open on one genuinely
   * blocks on a row lock held by the other — the contention PGlite cannot
   * express. Every pool is closed with the test.
   */
  connect: () => AppDb;
};

/**
 * Apply a migrations folder to one of this file's databases.
 *
 * `AppDb` is typed for PGlite, because PGlite is what the rest of the suite
 * runs on (src/db/client.ts). The two drivers expose the same query-builder
 * surface over the same schema and differ only in how they reach the server,
 * which is why {@link PostgresTestDatabase.connect} can hand back an `AppDb` at
 * all — but the migrator is the one API whose signature names its driver, so it
 * rejects the cast that everything else accepts.
 *
 * Hence this: the cast lives here, once, described, instead of being repeated
 * at every call site in `migrations.postgres.test.ts`. `Parameters<typeof
 * migrate>[0]` rather than a hand-written `NodePgDatabase<...>` so it keeps
 * tracking drizzle's own signature across upgrades.
 */
export async function applyMigrations(db: AppDb, migrationsFolder: string): Promise<void> {
  await migrate(db as unknown as Parameters<typeof migrate>[0], { migrationsFolder });
}

/** Postgres folds unquoted identifiers to lower case; keep the name unambiguous. */
function scratchDatabaseName(): string {
  return `diveday_test_${randomBytes(8).toString("hex")}`;
}

function withDatabase(connectionString: string, database: string): string {
  const url = new URL(connectionString);
  url.pathname = `/${database}`;
  return url.toString();
}

function poolFor(connectionString: string): Pool {
  // Same normalization production takes (src/db/client.ts). A plain local URL
  // passes through untouched, so this only bites if someone points the variable
  // at a managed server whose string carries an `sslmode`.
  return new Pool({ connectionString: withExplicitSslMode(connectionString), max: 4 });
}

/**
 * A migrated, empty scratch database on the configured server, dropped when the
 * calling test finishes.
 *
 * `{ migrations: false }` skips the migrate step for the one caller that is
 * *testing* migration application and needs to drive it itself.
 */
export async function postgresTestDb(
  options: { migrations?: boolean } = {},
): Promise<PostgresTestDatabase> {
  if (!hasRealPostgres) {
    throw new Error(
      "postgresTestDb() without DIVEDAY_TEST_POSTGRES_URL — wrap the suite in describePostgres",
    );
  }
  const name = scratchDatabaseName();

  // `CREATE DATABASE` cannot run inside a transaction block and takes no bind
  // parameters, hence the interpolation. `name` is hex out of `randomBytes`,
  // never caller input.
  const admin = poolFor(POSTGRES_TEST_URL);
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(POSTGRES_TEST_URL, name);
  const pools: Pool[] = [];
  const connect = (): AppDb => {
    const pool = poolFor(url);
    pools.push(pool);
    // Same cast production takes: the node-postgres and PGlite drivers expose
    // the same query-builder surface over the same schema and differ only in
    // how they reach the server, but their driver classes are distinct types.
    return drizzleNodePostgres({ client: pool }) as unknown as AppDb;
  };

  onTestFinished(async () => {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    const cleanup = poolFor(POSTGRES_TEST_URL);
    try {
      // `WITH (FORCE)` terminates anything still attached. Without it a pool
      // that failed to drain leaves the database undroppable, and a run slowly
      // fills the server with orphaned scratch databases.
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
    } finally {
      await cleanup.end();
    }
  });

  const db = connect();
  if (options.migrations !== false) await applyMigrations(db, "drizzle");
  return { db, url, connect };
}

/**
 * Hold a row lock open on its own connection until the returned `release` is
 * called — the starting gate a race test queues its contenders behind.
 *
 * `lockingSelect` is the caller's own `select … for update`, so the lock is
 * taken exactly as the code under test takes it, inside a real transaction that
 * simply awaits a promise, and released by an ordinary commit rather than by
 * anything test-shaped. Without a gate like this, two "concurrent" calls can
 * legally run one after the other and the test's `exactly one won` assertion
 * passes without a race ever happening.
 */
export async function holdRowLock(
  pg: PostgresTestDatabase,
  lockingSelect: SQL,
): Promise<{ release: () => Promise<void> }> {
  const gate = pg.connect();
  let release!: () => void;
  const held = new Promise<void>((resolve) => {
    release = resolve;
  });
  let acquired!: () => void;
  const locked = new Promise<void>((resolve) => {
    acquired = resolve;
  });
  const transaction = gate.transaction(async (tx) => {
    await tx.execute(lockingSelect);
    acquired();
    await held;
  });
  await locked;
  return {
    release: async () => {
      release();
      await transaction;
    },
  };
}

/** Rows out of a `db.execute` result, whichever shape the driver returned. */
function executedRows<T>(result: unknown): T[] {
  if (Array.isArray(result)) return result as T[];
  const rows = (result as { rows?: unknown })?.rows;
  return Array.isArray(rows) ? (rows as T[]) : [];
}

/**
 * Block until `count` backends on this scratch database are parked waiting for
 * a lock.
 *
 * A race test that fires two promises and hopes proves nothing: the assertion
 * "exactly one won" passes for a sequential run exactly as it does for a
 * contended one, so a guard could be deleted and the test stay green. Watching
 * `pg_stat_activity` turns "they raced" into something the test *observes* —
 * it does not release the contenders until Postgres itself reports both
 * transactions blocked on the same lock.
 *
 * What this establishes is **simultaneity, not the guard**. Callers should not
 * read a passing `waitForLockWaiters` as proof that the code under test locks
 * anything: a contender whose `INSERT` carries a foreign key to the gated row
 * takes a `KEY SHARE` lock on it during the FK check, and that conflicts with
 * the gate's `FOR UPDATE` whether or not the code under test took a lock of its
 * own. So this is the *setup* for the real assertion, and the real assertion is
 * always about the outcome — a seat count, an event chain — never about the
 * wait. Both suites using this helper say so at the point of use, because
 * getting it backwards invites deleting the assertion that actually works.
 */
export async function waitForLockWaiters(
  db: AppDb,
  count: number,
  timeoutMs = 10_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let waiting = 0;
  while (Date.now() <= deadline) {
    // `wait_event_type = 'Lock'` is Postgres' own account of a backend parked on
    // a heavyweight lock — what `SELECT ... FOR UPDATE` takes on a contended
    // row. Scoped to `current_database()`, so a sibling test's backends on the
    // same server can never satisfy the count.
    const result = await db.execute(sql`
      select count(*)::int as waiting
        from pg_stat_activity
       where datname = current_database()
         and wait_event_type = 'Lock'
    `);
    waiting = executedRows<{ waiting: number }>(result)[0]?.waiting ?? 0;
    if (waiting >= count) return;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(
    `waitForLockWaiters: ${waiting} of ${count} backends blocked after ${timeoutMs}ms — ` +
      "the contenders never met on the lock, so nothing was raced",
  );
}
