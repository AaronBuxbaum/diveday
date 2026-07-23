import { PGlite } from "@electric-sql/pglite";
import { drizzle } from "drizzle-orm/pglite";
import { type AppDb, createTestDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { templateBytes } from "./db-template";

/**
 * Fresh in-memory PGlite database seeded with the demo dataset. Each call
 * hydrates its own isolated database from the snapshot built by the Vitest
 * global setup (see db-template.ts) — do not cache or share a single instance
 * across tests.
 */
export async function seededTestDb(): Promise<AppDb> {
  const bytes = await templateBytes();
  if (!bytes) {
    // Global setup didn't run (foreign config / direct runner): pay full price.
    const db = await createTestDb();
    await seedDemo(db);
    return db;
  }
  const client = new PGlite({ loadDataDir: new Blob([bytes], { type: "application/x-tar" }) });
  return drizzle({ client });
}

/** As {@link seededTestDb}, plus the seeded "blue-mantis" demo shop row. */
export async function seededShopContext() {
  const db = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  return { db, shop };
}
