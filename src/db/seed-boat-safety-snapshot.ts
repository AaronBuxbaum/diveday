import { and, eq } from "drizzle-orm";
import { calendarDateInTimezone } from "@/lib/calendar-date";
import type { DbExecutor } from "./client";
import { boats, departureBoatSafetySnapshots, type trips } from "./schema";
import { DEMO_SHOP_TIMEZONE } from "./seed-clock";

/**
 * **The finished dawn boat's departure log shows a boat's papers filled in**
 * (issue #3650). Both seeds deleted boat-safety snapshots and wrote none, so
 * the log made for an insurer read "No record of the boat's papers and safety
 * kit was kept for this departure" and the section was only ever reviewed empty.
 *
 * One row, the shape `captureDepartureBoatSafety` writes at the last
 * departure-checkpoint tap before the lines come off: the certificate's limits,
 * the paper dates the boat row holds (none in the demo), the radio identity the emergency card printed, and no
 * notices (a blue-mantis boat is never seeded in a failure state, and a paper
 * inside its horizon would raise an errand on Today the live boat does not
 * carry). The certified limits follow the hull's capacity, as the row's
 * description says (passengers plus a three-person crew).
 */
export async function seedDepartureBoatSafetySnapshot(
  db: DbExecutor,
  shopId: string,
  trip: Pick<typeof trips.$inferSelect, "id" | "boatId" | "startsAt">,
): Promise<void> {
  if (!trip.boatId) return;
  const [boat] = await db
    .select({
      id: boats.id,
      name: boats.name,
      capacity: boats.capacity,
      callSign: boats.callSign,
      mmsi: boats.mmsi,
      workingChannel: boats.workingChannel,
    })
    .from(boats)
    .where(and(eq(boats.shopId, shopId), eq(boats.id, trip.boatId)))
    .limit(1);
  if (!boat) return;

  const judgedOn = calendarDateInTimezone(trip.startsAt, DEMO_SHOP_TIMEZONE);
  await db.insert(departureBoatSafetySnapshots).values({
    shopId,
    tripId: trip.id,
    boatId: boat.id,
    boatName: boat.name,
    judgedOn,
    departureStartsAt: trip.startsAt,
    papers: {
      certifiedPassengers: boat.capacity,
      certifiedTotalPersons: boat.capacity + 3,
      // The hull's own row carries no paper dates (the demo seeds none, see `seed.ts`), so the
      // snapshot invents none: a log dated on papers the boat does not hold would disagree
      // with the boat it names.
      coiExpiresOn: null,
      inspectionDueOn: null,
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    },
    radio: { callSign: boat.callSign, mmsi: boat.mmsi, workingChannel: boat.workingChannel },
    notices: [],
    // The last departure-checkpoint tap, a few minutes before she sailed.
    capturedAt: new Date(trip.startsAt.getTime() - 5 * 60_000),
  });
}
