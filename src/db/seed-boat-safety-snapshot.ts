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
 * departure-checkpoint tap before the lines come off: the certificate's
 * limits, paper dates and radio identity copied from the boat row (`seed.ts` gives
 * Mantis II all of them, dated past every paper's horizon so no errand fires on Today), and no
 * notices (a blue-mantis boat is never seeded in a failure state).
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
      certifiedPassengers: boats.certifiedPassengers,
      certifiedTotalPersons: boats.certifiedTotalPersons,
      coiExpiresOn: boats.coiExpiresOn,
      inspectionDueOn: boats.inspectionDueOn,
      registrationExpiresOn: boats.registrationExpiresOn,
      insuranceExpiresOn: boats.insuranceExpiresOn,
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
      certifiedPassengers: boat.certifiedPassengers,
      certifiedTotalPersons: boat.certifiedTotalPersons,
      coiExpiresOn: boat.coiExpiresOn,
      inspectionDueOn: boat.inspectionDueOn,
      registrationExpiresOn: boat.registrationExpiresOn,
      insuranceExpiresOn: boat.insuranceExpiresOn,
    },
    radio: { callSign: boat.callSign, mmsi: boat.mmsi, workingChannel: boat.workingChannel },
    notices: [],
    // The last departure-checkpoint tap, a few minutes before she sailed.
    capturedAt: new Date(trip.startsAt.getTime() - 5 * 60_000),
  });
}
