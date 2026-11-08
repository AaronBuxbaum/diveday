import { and, eq } from "drizzle-orm";
import type { AppDb } from "../../db/client";
import { recordRollCall } from "../../db/manifests";
import { boats, bookings, courses, people, trips } from "../../db/schema/index";
import { listStaff } from "../../db/trips";
import { seedOperationalTrust } from "./operational-trust";

/**
 * **A five-dive departure with a long passenger list** (`fiveDivePrint`): a
 * synthetic log for the print harness, never real shop data, with one seat
 * marked missing after dive five so the printed log carries every column.
 */
export async function logFiveDivesForPrint(
  db: AppDb,
  shop: { id: string; timezone: string },
  now: Date,
) {
  const state = await seedOperationalTrust(db, shop, "capacity", now);
  const [course] = await db
    .select({ id: courses.id })
    .from(courses)
    .where(and(eq(courses.shopId, shop.id), eq(courses.isActive, true)))
    .limit(1);
  const [actor] = await listStaff(db, shop.id);
  if (!course || !actor) throw new Error("five-dive print fixture requires a course and crew");
  await db
    .update(boats)
    .set({ capacity: 20, certifiedTotalPersons: 22 })
    .where(eq(boats.id, state.boatId));
  await db
    .update(trips)
    .set({ courseId: course.id, plannedDives: 5, capacity: 20 })
    .where(and(eq(trips.shopId, shop.id), eq(trips.id, state.tripId)));
  const [first] = state.seats;
  if (!first) throw new Error("five-dive print fixture requires a passenger");
  await db
    .update(people)
    .set({
      emergencyContactName: "Alexandria Fitzgerald-Sullivan",
      emergencyContactPhone: "+1-305-555-0148",
    })
    .where(and(eq(people.shopId, shop.id), eq(people.id, first.personId)));
  for (let index = 0; index < 10; index++) {
    const [person] = await db
      // diveday:allow-person-insert: a test fact's own fixture person, written only through /api/test/shop
      .insert(people)
      .values({
        shopId: shop.id,
        fullName: `Print passenger ${index + 1}`,
        emergencyContactName: "Alexandria Fitzgerald-Sullivan",
        emergencyContactPhone: "+1-305-555-0148",
      })
      .returning();
    if (!person) throw new Error("five-dive print fixture passenger missing");
    await db
      .insert(bookings)
      .values({ shopId: shop.id, tripId: state.tripId, personId: person.id, bookedAs: "diver" });
  }
  const mark = await recordRollCall(db, {
    shopId: shop.id,
    tripId: state.tripId,
    bookingId: first.bookingId,
    recordedByPersonId: actor.person.id,
    checkpoint: "after_dive_5",
    status: "not_boarded",
    occurredAt: now,
  });
  if (!mark.ok) throw new Error(`five-dive print mark refused: ${mark.reason}`);
  return { tripId: state.tripId };
}
