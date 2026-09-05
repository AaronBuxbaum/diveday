import { and, asc, eq } from "drizzle-orm";
import { MINUTE_MS } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { tripDives, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * **The demo's boat says where it is** — ADR 20260904-reef-all-the-way-down,
 * decision 2, Budget rule 4.
 *
 * One tap on today's departure, twenty minutes after it left the dock, so the
 * demo shop reads the way the canvas draws it: a chip on the home's station, a
 * live panel on the storefront, a line on the diver's link. It is deliberately
 * `underway` rather than `home` — `home` publishes nothing, so seeding it
 * would leave the whole slice invisible on the one shop every capture is of.
 *
 * A tap is a thing a person did, so it is recorded by the crew member who is
 * on the boat, and the site comes off the departure's own plan exactly as the
 * writer would stamp it.
 */
export async function seedTripStage(
  db: DbExecutor,
  shopId: string,
  recordedByPersonId: string,
): Promise<void> {
  const [today] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(and(eq(trips.shopId, shopId), liveTrip(), eq(trips.status, "scheduled")))
    .orderBy(asc(trips.startsAt))
    .limit(1);
  if (!today) return;

  const [firstDive] = await db
    .select({ diveSiteId: tripDives.diveSiteId })
    .from(tripDives)
    .where(eq(tripDives.tripId, today.id))
    .orderBy(asc(tripDives.diveNumber))
    .limit(1);

  await db.insert(tripStageEvents).values({
    shopId,
    tripId: today.id,
    stage: "underway",
    diveSiteId: firstDive?.diveSiteId ?? null,
    recordedByPersonId,
    recordedAt: new Date(today.startsAt.getTime() + 20 * MINUTE_MS),
  });
}
