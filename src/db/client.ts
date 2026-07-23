import { PGlite } from "@electric-sql/pglite";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import { withExplicitSslMode } from "./connection-string";
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

// Survive Next.js dev-server HMR: module state resets on reload, globalThis doesn't.
const globalForDb = globalThis as unknown as { divedayDbPromise?: Promise<AppDb> };

/**
 * Embedded Postgres (PGlite) and Neon Postgres are both bootstrapped with the
 * seeded demo shop on first connection. Production migrations still run
 * out-of-band via `pnpm db:migrate`; this seed is the required demo fixture,
 * not schema migration work.
 */
export function getDb(): Promise<AppDb> {
  globalForDb.divedayDbPromise ??= init();
  return globalForDb.divedayDbPromise;
}

async function init(): Promise<AppDb> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({
      connectionString: withExplicitSslMode(databaseUrl),
    });
    // Same schema, same query-builder surface as the PGlite driver below;
    // the driver classes differ only in how they execute over the wire.
    const db = drizzleNodePostgres({ client: pool }) as unknown as AppDb;
    await seedIfEmpty(db);
    return db;
  }

  const dataDir = process.env.PGLITE_DATA_DIR ?? ".pglite";
  const client = dataDir === "memory" ? new PGlite() : new PGlite(dataDir);
  const db = drizzle({ client });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedIfEmpty(db);
  return db;
}

/** Fresh in-memory database for tests: migrated, unseeded, isolated per call. */
export async function createTestDb(): Promise<AppDb> {
  const db = drizzle({ client: new PGlite() });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
