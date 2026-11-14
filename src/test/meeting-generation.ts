import { eq } from "drizzle-orm";
import type { DbExecutor } from "@/db/client";
import { shops, trips } from "@/db/schema";

export async function meetingGeneration(db: DbExecutor, tripId: string): Promise<number> {
  const [trip] = await db
    .select({ generation: trips.meetingScheduleGeneration })
    .from(trips)
    .where(eq(trips.id, tripId));
  if (!trip) throw new Error("fixture trip missing");
  return trip.generation;
}

export async function meetingIncarnation(db: DbExecutor, tripId: string): Promise<string> {
  const [row] = await db
    .select({ incarnation: shops.offlineDatasetIncarnation })
    .from(trips)
    .innerJoin(shops, eq(shops.id, trips.shopId))
    .where(eq(trips.id, tripId));
  if (!row) throw new Error("fixture trip missing");
  return row.incarnation;
}

export async function meetingProofScope(db: DbExecutor, tripId: string) {
  return {
    scheduleGeneration: await meetingGeneration(db, tripId),
    datasetIncarnation: await meetingIncarnation(db, tripId),
  };
}
