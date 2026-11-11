import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client";
import { upsertExecutedDive } from "../../db/executed-dives";
import { shops, trips } from "../../db/schema/index";
import { DEMO_TODAY_TRIP_TITLE } from "../../db/seed-trips";
import { listStaff } from "../../db/trips";
import { FactRefused } from "./refusal";

export const executedDepthArgs = z.object({
  unit: z.enum(["meters", "feet"]),
  meters: z.number().min(0).max(300).nullable(),
});

/** Prepare existing evidence, leaving the browser to exercise the edit and persistence. */
export async function seedExecutedDepth(
  db: AppDb,
  shopId: string,
  args: z.infer<typeof executedDepthArgs>,
) {
  const [trip] = await db
    .select({ id: trips.id })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), eq(trips.title, DEMO_TODAY_TRIP_TITLE)))
    .limit(1);
  const owner = (await listStaff(db, shopId)).find((staff) => staff.roles.includes("owner"));
  if (!trip || !owner) throw new FactRefused("no_trip_or_owner");
  await db.update(shops).set({ depthUnit: args.unit }).where(eq(shops.id, shopId));
  const saved = await upsertExecutedDive(db, {
    shopId,
    tripId: trip.id,
    diveNumber: 1,
    actualSiteId: null,
    maxDepthMeters: args.meters,
    recordedByPersonId: owner.person.id,
  });
  if (!saved.ok) throw new FactRefused(saved.reason);
  return { tripId: trip.id };
}
