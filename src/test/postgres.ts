import { randomBytes } from "node:crypto";
import { type SQL, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { describe, onTestFinished } from "vitest";
import type { AppDb } from "@/db/client";
import { prepareScratchDatabase } from "./postgres-cleanup";
import { adminOperation, type FixturePool, fixturePool } from "./postgres-io";

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
 * ## Two Postgres majors, and neither is the other
 *
 * The engine difference is not only the connection count. PGlite 0.5.8 reports
 * `PostgreSQL 18.3`; CI's `real-postgres` job runs a `postgres:16` service
 * container; production is Neon, and nobody has yet read which major that
 * actually is. So 182 of the 191 test files in `src/db` run against an engine
 * **two majors ahead** of the one that ships: a planner change, a behavioural
 * fix or a deprecation between 16 and 18 is untested in one direction and
 * unavailable in the other.
 *
 * **Accepted 2026-09-10 (#1383)** as a pre-pilot trade between suite speed, CI
 * cost and version fidelity. What makes it an accepted risk rather than an
 * unknown one is that it is measured: `src/db/engine-divergence.postgres.test.ts`
 * probes eleven behaviours across both engines, ten of which agree, and its
 * `major_version` row is the ledger that fails the day the gap moves. Two
 * things were considered and not done — pinning PGlite to an older release
 * (it tracks upstream, so holding it back trades a measured gap for an
 * unmaintained one), and widening the `real-postgres` job to a slice of the db
 * suite (available whenever it is wanted, at CI minutes proportional to the
 * slice). Moving production to 18 closes the gap from the other side and flips
 * the `major_version` probe to `agree`; that is the cheapest close, and it is
 * not this file's to make.
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

  const url = withDatabase(POSTGRES_TEST_URL, name);
  const pools: FixturePool[] = [];
  const connect = (): AppDb => {
    const managed = fixturePool(url, idleErrors);
    pools.push(managed);
    return drizzleNodePostgres({ client: managed.pool }) as unknown as AppDb;
  };

  await prepareScratchDatabase(
    name,
    pools,
    idleErrors,
    (label, work) => adminOperation(POSTGRES_TEST_URL, idleErrors, label, work),
    // Same existing 30s budget: pool close <=5s, drain <=10s, DROP <=10s.
    (cleanup) => onTestFinished(cleanup, 30_000),
  );

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
