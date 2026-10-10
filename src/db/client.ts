import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { getDbPoolConfig } from "@/lib/db-pool-config";
import { queryTimingLogger } from "@/lib/observability/query-timing";
import { withExplicitSslMode } from "./connection-string";
import { acquireDataDirLock } from "./data-dir-lock";

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
 * The demo bootstrap, loaded when a database is first opened rather than when
 * this module is. `client.ts` is imported by every route that touches the
 * database, and the bootstrap's graph reaches the seed, the demo keeper and
 * through them most of `src/db` — which imports `getDb` back from here. A
 * static edge put this module, the one that owns boot order, in a 26-file
 * import cycle with the Stripe providers and the trips modules
 * (`src/db/import-cycles.test.ts`); a dynamic one runs after this module has
 * finished evaluating, so the cycle cannot decide evaluation order. It also
 * keeps the bootstrap out of the module closure of every route that never
 * opens a cold database.
 */
function loadBootstrap() {
  return import("./dev-bootstrap");
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
    const db = drizzleNodePostgres({ client: pool, logger: queryTimingLogger }) as unknown as AppDb;
    try {
      const { seedProductionDb, takeSeedLock } = await loadBootstrap();
      await seedProductionDb(db, {
        lock: async (tx) => {
          await takeSeedLock(tx);
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

  return openLocalDb(process.env.PGLITE_DATA_DIR ?? ".pglite", { databaseUrl });
}

/**
 * The embedded-database half of {@link init}, opened, migrated and seeded.
 *
 * Exported with its steps injectable for one reason: the failure path is the
 * interesting one and cannot otherwise be reached from a test. A migration that
 * throws must leave **nothing** behind — not the ~170 MB PGlite instance, and
 * not the directory lock — because `getDb()` clears its memo on a rejection, so
 * the next request opens another one. Without the cleanup, a database that
 * fails to migrate stacks an instance per retry for as long as anything keeps
 * asking, and holds a lock naming a live process while doing it.
 */
export async function openLocalDb(
  dataDir: string,
  {
    databaseUrl,
    runMigrate = async (db) => {
      await migrate(db, { migrationsFolder: "drizzle" });
    },
  }: { databaseUrl?: string; runMigrate?: (db: AppDb) => Promise<void> } = {},
): Promise<AppDb> {
  // One process at a time on a directory on disk — see `src/db/data-dir-lock.ts`
  // for why PGlite needs that from outside itself. Taken before the client is
  // constructed, because after it there is already a second copy of the
  // database in memory. The in-memory branch is skipped: every process gets its
  // own database there, which is the isolation the e2e fleet is built on.
  const releaseDataDirLock = dataDir === "memory" ? undefined : acquireDataDirLock(dataDir);
  // `client` is assigned *inside* the try, so a constructor that throws still
  // drops the lock. Built the other way round it left a lock naming this very
  // process — alive, therefore believed — and every later attempt in the same
  // process refused to open the database it had locked against itself.
  let client: PGlite | undefined;
  try {
    // pg_trgm backs the trigram GIN search indexes (CR-018) and btree_gist the
    // gear-reservation exclusion constraint (ADR 20260815-minimal-gear-register)
    // — PGlite bundles each extension's wasm but only loads it when explicitly
    // requested here, unlike Neon/real Postgres where CREATE EXTENSION alone is
    // enough.
    client =
      dataDir === "memory"
        ? new PGlite({ extensions: { pg_trgm, btree_gist } })
        : new PGlite(dataDir, { extensions: { pg_trgm, btree_gist } });
    const db = drizzle({ client, logger: queryTimingLogger });
    await runMigrate(db);
    // No advisory lock here, because a Postgres advisory lock is a *database*
    // lock and each opener of this directory has its own database — see
    // `src/db/data-dir-lock.ts`, which is where that race is actually stopped.
    // The fast-path skip and the transactional atomicity are the same as the
    // Postgres branch above, and both still earn their keep across dev-server
    // restarts against a persisted `.pglite`.
    const { refreshPgliteDemo, seedProductionDb } = await loadBootstrap();
    await seedProductionDb(db);
    await refreshPgliteDemo(db, databaseUrl);
    return db;
  } catch (error) {
    // Nothing has been handed to a caller, so nothing else will ever close this
    // client or drop this lock. `getDb()` clears its memo on a rejection, so
    // the *next* request builds another one: without this, a database that
    // fails to migrate stacks a fresh ~170 MB PGlite instance — and an
    // un-droppable lock — on every retry, for as long as anything keeps asking.
    await client?.close().catch(() => undefined);
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
