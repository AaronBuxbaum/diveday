import { and, eq, isNull } from "drizzle-orm";
import type { AppDb } from "../../../db/client";
import { boats } from "../../../db/schema/index";
import type { Boat, BoatPapersInput } from "./store";

/**
 * A bare hull save for tests that only need a name, a seat count or papers on
 * a row. The product saves through `editBoatWithinCertificate`, which is the
 * one door that checks the certificate against the departures on the hull.
 */
export async function editBoat(
  db: AppDb,
  shopId: string,
  boatId: string,
  name: string,
  capacity: number,
  description: string | null = null,
  papers?: BoatPapersInput,
): Promise<Boat | null> {
  const [boat] = await db
    .update(boats)
    .set({ name, capacity, description, ...papers })
    .where(and(eq(boats.shopId, shopId), eq(boats.id, boatId), isNull(boats.deletedAt)))
    .returning();
  return boat ?? null;
}
