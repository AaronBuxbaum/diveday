import { and, eq, gte, isNull, or } from "drizzle-orm";
import type { getDb } from "@/db/client";
import { boats, trips } from "@/db/schema";
import { moveTrip } from "@/db/trips";
import { liveTrip } from "@/db/trips-live";
import { HOUR_MS } from "@/lib/clock";

/**
 * **Two departures on one hull at the same hours** (H-80, issue #2135): the
 * first two upcoming departures that do not overlap are put on the shop's
 * first boat, then the later one is moved onto the earlier one. Returns the
 * departure that moved and the one it landed on.
 */
async function slideOneDepartureOntoAnotherHull(
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  now: Date,
): Promise<{ tripId: string; otherTitle: string } | null> {
  const [hull] = await db
    .select({ id: boats.id })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), isNull(boats.deletedAt)))
    .orderBy(boats.name);
  if (!hull) return null;
  const upcoming = await db
    .select({ id: trips.id, title: trips.title, startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(
      and(
        eq(trips.shopId, shopId),
        eq(trips.status, "scheduled"),
        liveTrip(),
        gte(trips.startsAt, new Date(now.getTime() + HOUR_MS)),
      ),
    )
    .orderBy(trips.startsAt);
  const [host] = upcoming;
  const mover = upcoming.find(
    (trip) => trip.id !== host?.id && host && trip.startsAt >= host.endsAt,
  );
  if (!host || !mover) return null;
  const outcome = await moveTrip(db, shopId, mover.id, host.startsAt, {
    beforeMove: async (tx) => {
      const assigned = await tx
        .update(trips)
        .set({ boatId: hull.id })
        .where(
          and(
            eq(trips.shopId, shopId),
            eq(trips.status, "scheduled"),
            liveTrip(),
            or(
              and(
                eq(trips.id, host.id),
                eq(trips.startsAt, host.startsAt),
                eq(trips.endsAt, host.endsAt),
              ),
              eq(trips.id, mover.id),
            ),
          ),
        )
        .returning({ id: trips.id });
      if (assigned.length !== 2)
        throw new Error("boat-clash fixture trips changed before the move");
    },
  });
  if (!outcome.ok) return null;
  return { tripId: mover.id, otherTitle: host.title };
}

/**
 * `?boatClash=1`: opt-in, and it moves a departure (the board, Today's queue
 * and every calendar feed go with it), so only the capture that wants it asks.
 */
export async function boatClashState(
  request: Request,
  db: Awaited<ReturnType<typeof getDb>>,
  shopId: string,
  now: Date,
): Promise<{ boatClash?: { tripId: string; otherTitle: string } }> {
  if (new URL(request.url).searchParams.get("boatClash") !== "1") return {};
  const boatClash = await slideOneDepartureOntoAnotherHull(db, shopId, now);
  return boatClash ? { boatClash } : {};
}
