import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { recordCrewRollCall, recordRollCall } from "../../db/manifests";
import { boats, personRoles, tripAssignments } from "../../db/schema";
import { listStaff, setTripCrew } from "../../db/trips";
import { seedOperationalTrust } from "./operational-trust";

/** One private, bounded departure: four passengers, three crew roles, six people. */
export async function seedDualRoleManifest(
  db: AppDb,
  shop: { id: string; timezone: string },
  now: Date,
) {
  // The test door's generic actor may be a passenger, especially after cloning.
  // Roll-call writers require active staff; select one inside this same tenant.
  const [recorder] = await listStaff(db, shop.id);
  if (!recorder) throw new Error("dual-role fixture needs a staff recorder");
  const actorId = recorder.person.id;
  const fixture = await seedOperationalTrust(db, shop, "capacity", now);
  const shared = fixture.seats[0];
  if (!shared) throw new Error("dual-role passenger fixture missing");
  await db.insert(personRoles).values({ personId: shared.personId, role: "divemaster" });
  const crew = await db
    .select()
    .from(tripAssignments)
    .where(eq(tripAssignments.tripId, fixture.tripId));
  // Reserve every role before assigning; the certificate counts physical people.
  // Fixture limits are direct setup, while assignment and marks use supported writers.
  await db
    .update(boats)
    .set({ capacity: 7, certifiedPassengers: 4, certifiedTotalPersons: 6 })
    .where(and(eq(boats.shopId, shop.id), eq(boats.id, fixture.boatId)));
  const ids = [...crew.map((member) => member.personId), shared.personId];
  if (!(await setTripCrew(db, shop.id, fixture.tripId, ids)))
    throw new Error("dual-role assignment refused");
  for (const checkpoint of ["departure", "after_dive_1"] as const) {
    for (const seat of fixture.seats) {
      const result = await recordRollCall(db, {
        shopId: shop.id,
        tripId: fixture.tripId,
        bookingId: seat.bookingId,
        recordedByPersonId: actorId,
        status: "boarded",
        checkpoint,
        occurredAt: now,
      });
      if (!result.ok) throw new Error(`dual-role passenger mark refused: ${result.reason}`);
    }
    for (const personId of ids) {
      const result = await recordCrewRollCall(db, {
        shopId: shop.id,
        tripId: fixture.tripId,
        personId,
        recordedByPersonId: actorId,
        status: "boarded",
        checkpoint,
        occurredAt: now,
      });
      if (!result.ok) throw new Error(`dual-role crew mark refused: ${result.reason}`);
    }
  }
  const missing = await recordRollCall(db, {
    shopId: shop.id,
    tripId: fixture.tripId,
    bookingId: shared.bookingId,
    recordedByPersonId: actorId,
    status: "not_boarded",
    checkpoint: "after_dive_1",
    occurredAt: now,
  });
  if (!missing.ok) throw new Error(`dual-role missing mark refused: ${missing.reason}`);
  return {
    tripId: fixture.tripId,
    bookingId: shared.bookingId,
    personId: shared.personId,
    fullName: shared.fullName,
    passengers: 4,
    crew: 3,
    physicalTotal: 6,
  };
}
