import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { and, eq, sql } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { getDbPoolConfig } from "@/lib/db-pool-config";
import { withExplicitSslMode } from "./connection-string";
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
 * True for a Postgres unique-constraint violation (SQLSTATE 23505), however
 * many wrapper layers deep the driver buried it — drizzle-orm's own
 * `DrizzleQueryError` nests the real `pg`/PGlite error under `.cause`.
 * Callers use this to turn a losing race against a concurrent insert into a
 * graceful re-read instead of an unhandled throw (CR-008).
 */
export function isUniqueConstraintViolation(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; depth < 5 && current; depth++) {
    if (typeof current === "object" && "code" in current && current.code === "23505") return true;
    current = typeof current === "object" && "cause" in current ? current.cause : undefined;
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
 * locked, three-function path. `lock` is optional so the single-connection
 * PGlite branch (no cross-process race to guard against) can skip it.
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
  // pg_trgm backs the trigram GIN search indexes (CR-018) — PGlite bundles
  // the extension's wasm but only loads it when explicitly requested here,
  // unlike Neon/real Postgres where CREATE EXTENSION alone is enough.
  const client =
    dataDir === "memory"
      ? new PGlite({ extensions: { pg_trgm } })
      : new PGlite(dataDir, { extensions: { pg_trgm } });
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "drizzle" });
  // PGlite is single-connection (no cross-process race to guard against, so
  // no lock), but still gets the same fast-path skip + transactional
  // atomicity as the Postgres branch above — useful across dev-server
  // restarts against a persisted `.pglite` data dir.
  await seedProductionDb(db);
  return db;
}

/** Fresh in-memory database for tests: migrated, unseeded, isolated per call. */
export async function createTestDb(): Promise<AppDb> {
  const db = drizzle({ client: new PGlite({ extensions: { pg_trgm } }) });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
