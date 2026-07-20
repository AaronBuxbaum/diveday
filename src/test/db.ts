import { createTestDb } from "@/db/client";
import { seedDemo } from "@/db/seed";
import { getShopBySlug } from "@/db/shops";

/**
 * Fresh in-memory PGlite database seeded with the demo dataset, plus the seeded
 * "blue-mantis" shop. Each call creates its own isolated database — do not cache
 * or share a single instance across tests.
 */
export async function seededShopContext() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error('seeded demo shop "blue-mantis" missing');
  return { db, shop };
}
