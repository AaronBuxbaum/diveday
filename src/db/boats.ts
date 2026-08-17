import { and, eq } from "drizzle-orm";
import type { AppDb } from "./client";
import { boats } from "./schema";

export type Boat = typeof boats.$inferSelect;

export async function listBoats(db: AppDb, shopId: string): Promise<Boat[]> {
  return db.select().from(boats).where(eq(boats.shopId, shopId)).orderBy(boats.name);
}

export async function getBoatById(db: AppDb, shopId: string, boatId: string): Promise<Boat | null> {
  const [boat] = await db
    .select()
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .limit(1);
  return boat ?? null;
}

export async function createBoat(
  db: AppDb,
  shopId: string,
  name: string,
  capacity: number,
): Promise<Boat> {
  const [boat] = await db
    .insert(boats)
    .values({
      shopId,
      name,
      capacity,
    })
    .returning();
  if (!boat) {
    throw new Error("createBoat: failed to insert boat");
  }
  return boat;
}

export async function updateBoat(
  db: AppDb,
  shopId: string,
  boatId: string,
  name: string,
  capacity: number,
): Promise<Boat | null> {
  const [boat] = await db
    .update(boats)
    .set({ name, capacity })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .returning();
  return boat ?? null;
}

export async function deleteBoat(db: AppDb, shopId: string, boatId: string): Promise<boolean> {
  const result = await db
    .delete(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId)))
    .returning({ id: boats.id });
  return result.length > 0;
}
