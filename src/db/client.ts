import { PGlite } from "@electric-sql/pglite";
import type { ExtractTablesWithRelations } from "drizzle-orm";
import type { PgliteTransaction } from "drizzle-orm/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
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
 * Dev/test database: embedded Postgres (PGlite), auto-migrated and auto-seeded
 * on first connection so a fresh checkout boots into a working demo shop
 * (ADR-0005). Production swaps this file's internals for a server Postgres
 * driver behind the same getDb() seam.
 */
export function getDb(): Promise<AppDb> {
  globalForDb.scubaDbPromise ??= init();
  return globalForDb.scubaDbPromise;
}

async function init(): Promise<AppDb> {
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
