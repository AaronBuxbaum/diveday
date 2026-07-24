import { PGlite } from "@electric-sql/pglite";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { drizzle } from "drizzle-orm/pglite";
import { onTestFinished } from "vitest";
import { type AppDb, createTestDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";
import { templateBytes } from "./db-template";

/**
 * Close the test's PGlite when the test finishes.
 *
 * Every `seededTestDb()` call spins up a fresh embedded Postgres, and each one
 * pins ~250MB of resident memory. Left open, a single file's worth of tests
 * (~20) leaks multiple gigabytes into its Vitest worker, and the resulting GC
 * pressure drags every subsequent hydration from ~0.5s toward multiple seconds
 * — a cost that compounds as the suite grows. Releasing the instance the
 * moment the test that owns it ends keeps a worker's memory flat and its
 * hydrations warm. `onTestFinished` runs after both the test body and its
 * assertions, so the database stays live for the whole test.
 */
function closeWhenTestFinishes(client: PGlite): void {
  onTestFinished(async () => {
    await client.close();
  });
}

/**
 * Fresh in-memory PGlite database seeded with the demo dataset. Each call
 * hydrates its own isolated database from the snapshot built by the Vitest
 * global setup (see db-template.ts) — do not cache or share a single instance
 * across tests. The instance is closed automatically when the owning test
 * finishes.
 */
export async function seededTestDb(): Promise<AppDb> {
  const bytes = await templateBytes();
  if (!bytes) {
    // Global setup didn't run (foreign config / direct runner): pay full price.
    // Match the template — the lean demo, without the reporting history back-fill.
    const db = await createTestDb();
    await seedDemo(db, { history: false });
    closeWhenTestFinishes(db.$client as PGlite);
    return db;
  }
  const client = new PGlite({
    loadDataDir: new Blob([bytes], { type: "application/x-tar" }),
    extensions: { pg_trgm },
  });
  closeWhenTestFinishes(client);
  return drizzle({ client });
}

/** As {@link seededTestDb}, plus the seeded "blue-mantis" demo shop row. */
export async function seededShopContext() {
  const db = await seededTestDb();
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  return { db, shop };
}
