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

function poolFor(connectionString: string, idleErrors: Error[]): Pool {
  // Same normalization production takes (src/db/client.ts). A plain local URL
  // passes through untouched, so this only bites if someone points the variable
  // at a managed server whose string carries an `sslmode`.
  const pool = new Pool({ connectionString: withExplicitSslMode(connectionString), max: 4 });
  // A `pg.Pool` with no `error` listener is a process-killer, not merely
  // untidy. When a backend dies while its client is sitting *idle* in the pool
  // there is no query promise to reject onto, so pg-pool re-emits it as an
  // `'error'` event on the pool — and an unhandled `'error'` on an EventEmitter
  // is an uncaught exception, which in Vitest surfaces as
  // "Vitest caught 1 unhandled error during the test run" with every test still
  // reported as passing. Collecting them instead means the same event fails the
  // test that caused it, with a name attached; {@link assertNoIdleErrors} is
  // what turns the collection into that failure. Never swallowed: an entry here
  // that nobody reports would be worse than the crash.
  pool.on("error", (error: Error) => idleErrors.push(error));
  return pool;
}

/**
 * Wait until Postgres reports no backend attached to `database` any more,
 * answering with however many are still attached when the budget runs out.
 *
 * This exists because **`await pool.end()` does not mean the server-side
 * connections are gone.** pg-pool's shutdown path (`_pulseQueue`'s `ending`
 * branch → `_remove`) drops each idle client from its own bookkeeping
 * *synchronously* and then calls the asynchronous `client.end()` without
 * waiting for it, so `end()`'s promise resolves once a Terminate message has
 * been *queued* — not once the backend has processed it and exited. Measured on
 * pg-pool 3.14.0 against a local Postgres 16: seven pools opened, queried, and
 * all `end()`ed together left at least one live backend behind in **153 of 200**
 * iterations.
 *
 * Which was silently fine until the next statement this harness ran was
 * `DROP DATABASE … WITH (FORCE)`. Force terminates every backend still on the
 * database, so it was racing the graceful disconnects the same teardown had
 * just started: usually the backends won and exited first, occasionally the drop
 * did and killed one mid-goodbye. The loser receives
 * `FATAL 57P01 terminating connection due to administrator command`, which
 * arrives with no query in flight and therefore becomes the unhandled pool
 * `'error'` described above — a run where every test passes and the job still
 * fails. Waiting for the drain first is what removes the race; there is then
 * nothing left for the drop to terminate.
 *
 * Read from `pg_stat_activity` rather than from pg-pool's internals for the
 * same reason {@link waitForLockWaiters} does: it is the server's own account,
 * so it also covers a connection this harness never handed out (a raw
 * `pg.Client` a test opened itself, say) instead of only the pools it tracks.
 */
async function drainedBackends(admin: Pool, database: string, timeoutMs = 10_000): Promise<number> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    // The admin pool is connected to the *server's* default database, never to
    // `database`, so it can never count itself.
    const result = await admin.query<{ attached: number }>(
      "select count(*)::int as attached from pg_stat_activity where datname = $1",
      [database],
    );
    const attached = result.rows[0]?.attached ?? 0;
    if (attached === 0) return 0;
    if (Date.now() >= deadline) return attached;
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

/** Fail the test that produced an idle-client error, rather than the whole worker. */
function assertNoIdleErrors(idleErrors: Error[]): void {
  const [first] = idleErrors;
  if (!first) return;
  throw new Error(
    `postgresTestDb: ${idleErrors.length} connection(s) died while idle in a pool — ` +
      `first: ${first.message}`,
    { cause: first },
  );
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
  const idleErrors: Error[] = [];

  // `CREATE DATABASE` cannot run inside a transaction block and takes no bind
  // parameters, hence the interpolation. `name` is hex out of `randomBytes`,
  // never caller input.
  const admin = poolFor(POSTGRES_TEST_URL, idleErrors);
  try {
    await admin.query(`CREATE DATABASE "${name}"`);
  } finally {
    await admin.end();
  }

  const url = withDatabase(POSTGRES_TEST_URL, name);
  const pools: Pool[] = [];
  const connect = (): AppDb => {
    const pool = poolFor(url, idleErrors);
    pools.push(pool);
    // Same cast production takes: the node-postgres and PGlite drivers expose
    // the same query-builder surface over the same schema and differ only in
    // how they reach the server, but their driver classes are distinct types.
    return drizzleNodePostgres({ client: pool }) as unknown as AppDb;
  };

  onTestFinished(async () => {
    await Promise.all(pools.map((pool) => pool.end().catch(() => undefined)));
    const cleanup = poolFor(POSTGRES_TEST_URL, idleErrors);
    try {
      // Ending the pools only *asks* their backends to go; this is where we find
      // out they actually did (see {@link drainedBackends} for why the two are
      // not the same thing and what dropping without asking used to cost).
      const stranded = await drainedBackends(cleanup, name);
      if (stranded === 0) {
        // Nothing is attached, so a plain drop cannot terminate anything. The
        // `WITH (FORCE)` this line used to carry unconditionally is exactly what
        // made teardown able to kill a healthy connection.
        await cleanup.query(`DROP DATABASE IF EXISTS "${name}"`);
        assertNoIdleErrors(idleErrors);
        return;
      }
      // A connection that never drained is a real leak in the test — something
      // was opened and not closed, and no amount of further waiting fixes it.
      // Force the drop anyway so a failing run does not leave the server filling
      // up with orphaned scratch databases, then say so. The forced termination
      // may itself land an idle-client error in `idleErrors`; that is a
      // consequence of the leak, so it rides along in the cause rather than
      // replacing this message.
      await cleanup.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      throw new Error(
        `postgresTestDb: ${stranded} connection(s) to ${name} were still attached after every ` +
          "pool was ended — something opened a connection the test never closed",
        { cause: idleErrors[0] },
      );
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
 *
 * The gate is also released for you if the test never gets that far. An
 * unreleased gate is not a small leak: its transaction never commits, so its
 * client never returns to the pool, so the teardown's `pool.end()` — which does
 * wait for *checked-out* clients — waits forever, and a test that failed on an
 * assertion reports as a teardown timeout instead. Vitest runs `onTestFinished`
 * hooks in reverse registration order, and this one is registered after
 * {@link postgresTestDb}'s, so the gate is always released before the pools it
 * belongs to are closed.
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
  // Raced rather than plainly awaited: if the locking select itself fails, the
  // transaction rejects and `acquired()` is never called, so awaiting `locked`
  // alone would hang on a promise nothing can resolve and hide the real error.
  await Promise.race([locked, transaction]);
  let releasing: Promise<void> | undefined;
  const releaseOnce = (): Promise<void> => {
    releasing ??= (async () => {
      release();
      await transaction;
    })();
    return releasing;
  };
  onTestFinished(releaseOnce);
  return { release: releaseOnce };
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
 * always about the outcome — a seat count, an event chain, a count of calls the
 * payment provider received — never about the wait. Every suite using this
 * helper says so at the point of use, because getting it backwards invites
 * deleting the assertion that actually works: `refunds.postgres.test.ts`'s
 * header claimed the opposite for a while, and the claim was wrong.
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
