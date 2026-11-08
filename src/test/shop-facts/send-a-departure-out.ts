import { and, eq } from "drizzle-orm";
import { z } from "zod";
import type { AppDb } from "../../db/client";
import { trips } from "../../db/schema/index";
import { liveTrip } from "../../db/trips";
import { MINUTE_MS } from "../../lib/clock";
import { FactRefused } from "./refusal";

export const departTripArgs = z
  .object({
    tripId: z.string().trim().min(1),
    /** How long ago it left; `positive()` also refuses `NaN` and an infinity. */
    minutesAgo: z.number().positive(),
  })
  .strict();

/**
 * **Send one named departure out without its divers** (`departTrip`), by moving
 * its times back rather than moving the clock.
 *
 * The counter's "Not here" door opens when the boat leaves without the diver
 * and says a different thing once it is really gone (`noShowGate` and
 * `noShowClaim`, src/lib/no-show.ts). Neither state can be built inside a spec
 * otherwise: the fleet's clock is frozen and process-wide per worker, a seat
 * cannot be *sold* onto a departure that has sailed (`createBooking` refuses
 * `trip_unavailable`), and nobody can join a wait list for one that has left.
 * So a spec fills a future boat and then sends it out. The `evening` fact moves
 * the whole day for the same reason; this one moves only the trip the caller
 * names, so a spec cannot quietly re-time somebody else's boat.
 *
 * `minutesAgo` is how long ago it left. Under 60 leaves it inside the standing
 * one-hour late-arrival buffer (`hasSailed`, src/lib/trips.ts), the
 * seat-still-sellable half of the door; past 60 it is gone. The whole trip
 * slides, `endsAt` keeping its duration, because a boat that left earlier gets
 * home earlier.
 */
export async function sendADepartureOut(
  db: AppDb,
  shopId: string,
  { tripId, minutesAgo }: z.output<typeof departTripArgs>,
  now: Date,
) {
  const [trip] = await db
    .select({ startsAt: trips.startsAt, endsAt: trips.endsAt })
    .from(trips)
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId), liveTrip()))
    .limit(1);
  if (!trip) throw new FactRefused("not_found", 404);

  const startsAt = new Date(now.getTime() - minutesAgo * MINUTE_MS);
  // Only ever backwards, the same one-directional discipline `api/test/clock`
  // keeps: a departure dragged *forward* would put a recorded arrival before
  // the boat it was recorded against.
  if (startsAt.getTime() >= trip.startsAt.getTime()) throw new FactRefused("would_move_forwards");
  const endsAt = new Date(trip.endsAt.getTime() - (trip.startsAt.getTime() - startsAt.getTime()));

  // The tenant predicate rides on the write too, not only on the read that
  // cleared it: `tripId` came from the caller, and a caller-supplied id is
  // re-scoped by every query that touches it (`.claude/rules/db.md`, "Tenant
  // isolation").
  await db
    .update(trips)
    // diveday:allow-flat-revision: the same fixture reasoning as the `evening`
    // fact — one named departure re-timed inside a per-worker test database,
    // which no calendar client has ever fetched. `moveTrip` is the door a shop
    // moves a real departure through, and it bumps.
    .set({ startsAt, endsAt })
    .where(and(eq(trips.id, tripId), eq(trips.shopId, shopId)));
  return { startsAt: startsAt.toISOString() };
}
