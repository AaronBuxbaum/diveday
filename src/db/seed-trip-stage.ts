import { and, asc, eq, gt, lte } from "drizzle-orm";
import { MINUTE_MS, nowDate } from "@/lib/clock";
import type { DbExecutor } from "./client";
import { tripDives, tripStageEvents, trips } from "./schema";
import { liveTrip } from "./trips-live";

/**
 * When the crew of a boat that is already out would have tapped **Underway**:
 * twenty minutes after the lines came off, or this instant if she has not been
 * out that long.
 *
 * The clamp is the whole point. `liveShopStage` refuses a reading stamped after
 * the moment it is read — a word from the future is not a word anyone has said
 * — so an unclamped `startsAt + 20m` on a boat that left ten minutes ago seeds a
 * row that no surface will ever render, and the demo's chip, its storefront
 * panel and every diver's line all come up blank on the one shop every capture
 * is of.
 */
export function demoStageRecordedAt(startsAt: Date, now: Date): Date {
  return new Date(Math.min(startsAt.getTime() + 20 * MINUTE_MS, now.getTime()));
}

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
  // The departure that is out *right now*, or the next one boarding. Anything
  // else and the demo seeds a word that has already gone stale — a stage stops
  // speaking once a boat's own day is over, which is the rule, and a seed that
  // ignored it would leave the whole slice invisible on the one shop every
  // capture is of.
  const now = nowDate();
  const [running] = await db
    .select({ id: trips.id, startsAt: trips.startsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        liveTrip(),
        eq(trips.status, "scheduled"),
        lte(trips.startsAt, now),
        gt(trips.endsAt, now),
      ),
    )
    .orderBy(asc(trips.startsAt))
    .limit(1);
  const [upcoming] = running
    ? []
    : await db
        .select({ id: trips.id, startsAt: trips.startsAt })
        .from(trips)
        .where(
          and(
            eq(trips.shopId, shopId),
            liveTrip(),
            eq(trips.status, "scheduled"),
            gt(trips.startsAt, now),
          ),
        )
        .orderBy(asc(trips.startsAt))
        .limit(1);
  const today = running ?? upcoming;
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
    // A boat that has left is out on its site; one still at the dock is
    // boarding, which is the word its crew would have tapped.
    stage: running ? "underway" : "boarding",
    diveSiteId: firstDive?.diveSiteId ?? null,
    recordedByPersonId,
    recordedAt: running ? demoStageRecordedAt(today.startsAt, now) : now,
  });
}
