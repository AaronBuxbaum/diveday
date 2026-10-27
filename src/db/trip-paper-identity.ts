import { and, eq, sql } from "drizzle-orm";
import type { DbExecutor } from "./client";
import { boats, shops, trips } from "./schema";
import { liveTrip } from "./trips-live";

/** Row versions detect edits even when an identity changes A → B → A. */
export async function readTripPaperIdentity(db: DbExecutor, shopId: string, tripId: string) {
  const [identity] = await db
    .select({
      tripId: trips.id,
      title: trips.title,
      startsAt: trips.startsAt,
      endsAt: trips.endsAt,
      boatId: trips.boatId,
      vesselName: boats.name,
      shopName: shops.name,
      timezone: shops.timezone,
      tripVersion: sql<string>`${trips}.xmin::text`,
      boatVersion: sql<string | null>`${boats}.xmin::text`,
      shopVersion: sql<string>`${shops}.xmin::text`,
    })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .leftJoin(boats, and(eq(boats.id, trips.boatId), eq(boats.shopId, shopId)))
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()));
  return identity ?? null;
}
