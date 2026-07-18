import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import { drizzle as drizzleNodePostgres } from "drizzle-orm/node-postgres";
import type { PgliteTransaction } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import { Pool } from "pg";
import * as schema from "./schema";
import { seedIfEmpty } from "./seed";

export type AppDb = ReturnType<typeof drizzle<typeof schema>>;
export type AppTransaction = PgliteTransaction<
  typeof schema,
  ExtractTablesWithRelations<typeof schema>
>;
/** Query services may accept either the app database or its transaction boundary. */
export type DbExecutor = AppDb | AppTransaction;

// Survive Next.js dev-server HMR: module state resets on reload, globalThis doesn't.
const globalForDb = globalThis as unknown as { scubaDbPromise?: Promise<AppDb> };

/**
 * Dev/test database (no DATABASE_URL): embedded Postgres (PGlite), auto-migrated
 * and auto-seeded on first connection so a fresh checkout boots into a working
 * demo shop (ADR-0005). Production (DATABASE_URL set, Neon Postgres via Vercel —
 * see docs/architecture/decisions/20260718-vercel-neon-hosting.md) connects
 * through node-postgres instead; migrations there run out-of-band via
 * `pnpm db:migrate`, never on request paths.
 */
export function getDb(): Promise<AppDb> {
  globalForDb.scubaDbPromise ??= init();
  return globalForDb.scubaDbPromise;
}

async function init(): Promise<AppDb> {
  const databaseUrl = process.env.DATABASE_URL;
  if (databaseUrl) {
    const pool = new Pool({ connectionString: databaseUrl });
    // Same schema, same query-builder surface as the PGlite driver below;
    // the driver classes differ only in how they execute over the wire.
    return drizzleNodePostgres({ client: pool, schema }) as unknown as AppDb;
  }

  const dataDir = process.env.PGLITE_DATA_DIR ?? ".pglite";
  const client = dataDir === "memory" ? new PGlite() : new PGlite(dataDir);
  const db = drizzle(client, { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  await seedIfEmpty(db);
  return db;
}

/** Fresh in-memory database for tests: migrated, unseeded, isolated per call. */
export async function createTestDb(): Promise<AppDb> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: "drizzle" });
  return db;
}
