import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { PgAsyncTransaction } from "drizzle-orm/pg-core";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { getDbPoolConfig } from "@/lib/db-pool-config";
import { withExplicitSslMode } from "./connection-string";
import { acquireDataDirLock } from "./data-dir-lock";
import { refreshCanonicalDemoSchedule } from "./demo-refresh";
import { DEMO_SHOP_SLUG } from "./dev-credentials";
import { shops } from "./schema";
import { seedIfEmpty } from "./seed";

// drizzle 1.0 moved relational config out of the driver `schema` option
// (into `defineRelations`); we build queries through `.select()/.from()`, which
// take their types from the tables, so the db is typed by its driver alone.
export type AppDb = ReturnType<typeof drizzle>;
type TransactionCallback = Parameters<AppDb["transaction"]>[0];
export type AppTransaction = TransactionCallback extends (tx: infer T) => Promise<unknown>
  ? T
  : never;
/** Query services may accept either the app database or its transaction boundary. */
export type DbExecutor = AppDb | AppTransaction;

/**
 * Run several independent queries, concurrently only where that is real.
 *
 * A `DbExecutor` is either the pool — where two queries genuinely run at once,
 * on two connections — or a transaction, which is **one checked-out client**.
 * Handing that client concurrent queries buys nothing: `pg` queues them behind
 * each other and warns that it will stop accepting them in pg@9
 * ("Calling client.query() when the client is already executing a query is
 * deprecated"). The parallelism was never real; only the warning was.
 *
 * So a reader shared between a page render and a transaction cannot simply
 * choose. `src/db/trips-schedule.ts` met this first (issue #517) and went
 * sequential, which was right there because it only ever runs in a transaction.
 * `listTripsReadiness` is the other shape: the roster, the manifest and Today
 * all call it on the pool, where the fan-out is worth having, and
 * `checkInBooking` calls it inside its transaction, where it is the warning
 * seen in production on 2026-08-14. This lets one reader be correct in both
 * places instead of being written twice.
 */
export async function queryAll<T extends readonly unknown[] | []>(
  db: DbExecutor,
  queries: { [K in keyof T]: () => Promise<T[K]> },
): Promise<T> {
  if (!isTransactionExecutor(db)) return Promise.all(queries.map((run) => run())) as Promise<T>;
  const results = [];
  for (const run of queries) results.push(await run());
  return results as unknown as T;
}

/**
 * Whether this executor is a transaction — one pinned connection — rather than
 * the pool. Both drivers' transaction classes (`NodePgTransaction` in
 * production, `PgliteTransaction` in tests) extend drizzle's `PgAsyncTransaction`,
 * so the one check covers both.
 */
export function isTransactionExecutor(db: DbExecutor): boolean {
  return db instanceof PgAsyncTransaction;
}

/**
 * Every error in a thrown value's `.cause` chain, outermost first.
 *
 * A driver error never arrives bare: drizzle-orm wraps it in its own
 * `DrizzleQueryError`, whose top level carries **neither** `code` nor
 * `constraint` — both sit on the `pg`/PGlite error nested under `.cause`. Every
 * reader below walks the chain for that reason, and the depth bound keeps a
 * self-referential `cause` from spinning.
 */
function* errorChain(error: unknown): Generator<Record<string, unknown>> {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current !== "object") return;
    yield current as Record<string, unknown>;
    current = "cause" in current ? current.cause : undefined;
  }
}

/**
 * Postgres's own SQLSTATE for a failed query — `"23505"`, `"23503"`, and so on
 * — or `undefined` for a failure that never reached the database.
 *
 * Worth having as one function rather than an inline `(error as {code}).code`
 * at each call site, because that inline form reads the *wrapper*, where the
 * field is always absent. `/api/cron/demo-refresh` shipped exactly that and its
 * failure log carried `sqlState: undefined` for every real query error — the
 * one field added (issue #517) so an operator would not have to open Sentry to
 * learn the shape of a failure.
 *
 * A closed vocabulary of five characters: it cannot carry a row value, so it is
 * safe in a structured log line under the no-PII rule.
 */
export function sqlStateOf(error: unknown): string | undefined {
  for (const link of errorChain(error)) {
    if (typeof link.code === "string") return link.code;
  }
  return undefined;
}

/**
 * True for a unique violation raised by one **named** index, so a caller can
 * turn that one collision into a worded refusal without also swallowing an
 * unrelated 23505 from another index the same write touched.
 */
export function violatesUniqueIndex(error: unknown, indexName: string): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23505" && link.constraint === indexName) return true;
  }
  return false;
}

/**
 * True for an exclusion-constraint violation (SQLSTATE 23P01) raised by one
 * **named** constraint. The sibling of `violatesUniqueIndex` for the other
 * constraint family: the gear-reservation double-booking guard is an
 * `EXCLUDE USING gist`, whose refusal a caller turns into a worded outcome
 * rather than a 500 (ADR 20260815-minimal-gear-register).
 */
export function violatesExclusionConstraint(error: unknown, constraintName: string): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23P01" && link.constraint === constraintName) return true;
  }
  return false;
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), however
 * many wrapper layers deep the driver buried it.
 * Callers use this to turn a losing race against a concurrent insert into a
 * graceful re-read instead of an unhandled throw (CR-008).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  for (const link of errorChain(error)) {
    if (link.code === "23505") return true;
  }
  return false;
}

// Survive Next.js dev-server HMR: module state resets on reload, globalThis doesn't.
const globalForDb = globalThis as unknown as { divedayDbPromise?: Promise<AppDb> };

/**
 * Embedded Postgres (PGlite) and Neon Postgres are both bootstrapped with the
 * seeded demo shop on first connection. Production migrations still run
 * out-of-band via `pnpm db:migrate`; this seed is the required demo fixture,
 * not schema migration work.
 *
 * A failed cold start must not poison this process forever (CR-010): if
 * `init()` rejects, the `.catch` clears the memoized promise before
 * rethrowing, so the *next* `getDb()` call gets a fresh attempt instead of
 * permanently returning the same rejected promise.
 */
export function getDb(): Promise<AppDb> {
  globalForDb.divedayDbPromise ??= init().catch((error) => {
    globalForDb.divedayDbPromise = undefined;
    throw error;
  });
  return globalForDb.divedayDbPromise;
}

/**
 * Arbitrary fixed key for the demo-seed advisory lock (CR-010) — any int8
 * works; it only has to be stable and not collide with another lock this app
 * might one day take. Picked by typing on the keyboard, not derived from
 * anything meaningful.
 */
const SEED_LOCK_KEY = 872_363_841;

/**
 * Cheap "already seeded" marker: a single indexed-lookup `SELECT`, no
 * transaction, no lock. `seedDemo`'s one transaction either inserts this row
 * or never runs at all, and it is never reaped (see `reapExpiredDemoShops`
 * in seed.ts, which excludes `DEMO_SHOP_SLUG`), so once this is true it stays
 * true for the life of the database — the fast path below trusts it
 * unconditionally instead of re-deriving it from scratch.
 */
export async function isDemoShopSeeded(db: DbExecutor): Promise<boolean> {
  const [existing] = await db
    .select({ id: shops.id })
    .from(shops)
    .where(and(eq(shops.slug, DEMO_SHOP_SLUG), eq(shops.isDemo, true)))
    .limit(1);
  return Boolean(existing);
}

/**
 * Cold-start seed/backfill fast path (audit: docs/product/archive/
 * specialist-optimization-audit-20260731.md §7 "Trim production cold-start
 * work"). Every cold start used to unconditionally open a transaction, take
 * a cross-process advisory lock, and run three scans of seed.ts's checks —
 * on a long-lived, already-seeded database (the overwhelmingly common case
 * once the demo shop exists) that work is pure waste repeated on every new
 * serverless instance. `isDemoShopSeeded` short-circuits all of it with one
 * cheap `SELECT`; only a genuinely fresh database falls through to the slow,
 * locked, three-function path. `lock` is optional because the PGlite branch has
 * nothing to take one *on* — an advisory lock is held by a database, and two
 * openers of one data directory do not share one (see `init`).
 */
export async function seedProductionDb(
  db: AppDb,
  opts: { lock?: (tx: AppTransaction) => Promise<void> } = {},
): Promise<void> {
  if (await isDemoShopSeeded(db)) return;
  await db.transaction(async (tx) => {
    // Serializes concurrent cold starts across separate serverless
    // instances/processes racing to seed the same fresh database — the
    // in-process promise memoization above can dedupe concurrent calls
    // within one process, but a genuinely separate process (a second
    // Vercel function instance handling a concurrent request) has its
    // own `globalThis` and never sees it. A transaction-scoped Postgres
    // advisory lock reaches across that boundary and is automatically
    // released at commit/rollback — including if the process crashes —
    // so a dead process can never leave it stuck (CR-010).
    await opts.lock?.(tx);
    // Also makes the whole seed atomic: everything seedIfEmpty inserts
    // now runs inside this one transaction, so a failure partway
    // through rolls back every row instead of leaving a half-seeded
    // shop a retry would find already-non-empty and stop repairing.
    await seedIfEmpty(tx);
  });
}

/**
 * Keep the persisted local playground current without ever touching a real
 * database. Production gets this pass from `/api/cron/demo-refresh`; a local
 * PGlite database has no cron, so the natural equivalent is the next dev boot.
 * The explicit URL guard stays here as well as at the call site so a future
 * caller cannot accidentally run the demo keeper against a configured pool.
 */
export async function refreshPgliteDemo(db: AppDb, databaseUrl = process.env.DATABASE_URL) {
  if (databaseUrl) return;
  await refreshCanonicalDemoSchedule(db);
}

/**
 * Open the database this process will use for its lifetime.
 *
 * **PGlite takes no lock on its data directory**, in process or across
 * processes. Two openers of the same `.pglite` do not error, do not warn and do
 * not block — they fork the database, each seeing only its own writes, and
 * whichever closes last lands its copy on disk over the other's. Verified by
 * experiment on 2026-09-03: two processes, forty committed rows each, neither
 * observing the other, one set surviving and no output from anybody.
 *
 * The file-backed branch below therefore takes one from outside PGlite, so a
 * `pnpm build` beside a running `pnpm dev` is a refusal naming the process to
 * stop rather than silent data loss — `src/db/data-dir-lock.ts` carries the
 * mechanism and what it cannot reach (ADR 20260903-one-process-per-pglite-directory).
 * `pnpm db:reset` refuses on the same grounds from the other side.
 *
 * The in-memory branch takes no lock and needs none: every process gets its own
 * database, which is the isolation the e2e and visual fleets are built on.
 */
async function init(): Promise<AppDb> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({
      connectionString: withExplicitSslMode(databaseUrl),
      // Sized for serverless: every concurrent cold instance gets its own
      // `Pool`, so pg's un-tuned default (`max: 10`, no timeouts) multiplies
      // badly against Neon's shared per-database connection cap. See
      // src/lib/db-pool-config.ts for the reasoning behind each value and
      // their env-var overrides.
      ...getDbPoolConfig(),
    });
    // Same schema, same query-builder surface as the PGlite driver below;
    // the driver classes differ only in how they execute over the wire.
    const db = drizzleNodePostgres({ client: pool }) as unknown as AppDb;
    try {
      await seedProductionDb(db, {
        lock: async (tx) => {
          await tx.execute(sql`select pg_advisory_xact_lock(${SEED_LOCK_KEY})`);
        },
      });
    } catch (error) {
      // The transaction failed before the pool was ever handed back to a
      // caller — nothing else will ever close it, so a repeated failed cold
      // start would otherwise leak one connection per attempt.
      await pool.end().catch(() => undefined);
      throw error;
    }
    return db;
  }

  const dataDir = process.env.PGLITE_DATA_DIR ?? ".pglite";
  // One process at a time on a directory on disk — see `src/db/data-dir-lock.ts`
  // for why PGlite needs that from outside itself. Taken before the client is
  // constructed, because after it there is already a second copy of the
  // database in memory. The in-memory branch is skipped: every process gets its
  // own database there, which is the isolation the e2e fleet is built on.
  const releaseDataDirLock = dataDir === "memory" ? undefined : acquireDataDirLock(dataDir);
  // pg_trgm backs the trigram GIN search indexes (CR-018) and btree_gist the
  // gear-reservation exclusion constraint (ADR 20260815-minimal-gear-register)
  // — PGlite bundles each extension's wasm but only loads it when explicitly
  // requested here, unlike Neon/real Postgres where CREATE EXTENSION alone is
  // enough.
  const client =
    dataDir === "memory"
      ? new PGlite({ extensions: { pg_trgm, btree_gist } })
      : new PGlite(dataDir, { extensions: { pg_trgm, btree_gist } });
  try {
    const db = drizzle({ client });
    await migrate(db, { migrationsFolder: "drizzle" });
    // No advisory lock here, because a Postgres advisory lock is a *database*
    // lock and each opener of this directory has its own database — see
    // `src/db/data-dir-lock.ts`, which is where that race is actually stopped.
    // The fast-path skip and the transactional atomicity are the same as the
    // Postgres branch above, and both still earn their keep across dev-server
    // restarts against a persisted `.pglite`.
    await seedProductionDb(db);
    await refreshPgliteDemo(db, databaseUrl);
    return db;
  } catch (error) {
    // Nothing has been handed to a caller, so nothing else will ever close this
    // client or drop this lock. `getDb()` clears its memo on a rejection, so
    // the *next* request builds another one: without this, a database that
    // fails to migrate stacks a fresh ~170 MB PGlite instance — and an
    // un-droppable lock — on every retry, for as long as anything keeps asking.
    await client.close().catch(() => undefined);
    releaseDataDirLock?.();
    throw error;
  }
}

/** Fresh in-memory database for tests: migrated, unseeded, isolated per call. */
export async function createTestDb(): Promise<AppDb> {
  const db = drizzle({ client: new PGlite({ extensions: { pg_trgm, btree_gist } }) });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
