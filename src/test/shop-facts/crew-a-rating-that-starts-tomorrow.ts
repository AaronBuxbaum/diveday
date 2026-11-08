import { eq } from "drizzle-orm";
import { createBooking } from "../../db/bookings";
import type { AppDb } from "../../db/client";
import {
  courses,
  people,
  personRoles,
  staffCredentials,
  tripAssignments,
} from "../../db/schema/index";
import { createTrip } from "../../db/trips";
import { calendarDateInTimezone, shiftCalendarDate } from "../../lib/calendar-date";
import { HOUR_MS } from "../../lib/clock";

/**
 * **An instructor crewed on a course whose rating starts tomorrow** (`futureCrew`):
 * a fictional rating issued the day after the departure, the instructor on its
 * roster with one student, and an unstaffed control session beside it. A
 * private shop's fact: it adds a person to the crew list.
 */
export async function crewARatingThatStartsTomorrow(
  db: AppDb,
  shop: { id: string; timezone: string },
  now: Date,
) {
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  const course = catalog.find(
    (row) =>
      !row.isIntroCourse && row.agency.toLowerCase() === "padi" && !row.minimumCertificationLevel,
  );
  if (!course) throw new Error("future crew fixture needs an entry course");
  const [person] = await db
    // diveday:allow-person-insert: a test fact's own fixture person, written only through /api/test/shop
    .insert(people)
    .values({ shopId: shop.id, fullName: "Alex Future" })
    .returning();
  if (!person) throw new Error("future crew fixture needs a person");
  await db.insert(personRoles).values({ personId: person.id, role: "instructor" });
  const startsAt = new Date(now.getTime() + 3 * HOUR_MS);
  const issueDate = shiftCalendarDate(calendarDateInTimezone(startsAt, shop.timezone), 1);
  await db.insert(staffCredentials).values({
    shopId: shop.id,
    personId: person.id,
    kind: "instructor_rating",
    name: "Synthetic instructor rating",
    issuedAt: issueDate,
    renewsAt: shiftCalendarDate(issueDate, 365),
  });
  const trip = await createTrip(db, {
    shopId: shop.id,
    courseId: course.id,
    title: "Legacy rating check",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 8,
    plannedDives: 1,
  });
  if (!trip) throw new Error("future crew fixture needs a departure");
  const emptyTrip = await createTrip(db, {
    shopId: shop.id,
    courseId: course.id,
    title: "Unstaffed course",
    startsAt,
    endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
    capacity: 8,
    plannedDives: 1,
  });
  if (!emptyTrip) throw new Error("future crew fixture needs a roster control");
  await db.insert(tripAssignments).values({ tripId: trip.id, personId: person.id });
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Synthetic student",
    email: "future-crew-student@example.test",
  });
  if (!booking.ok) throw new Error(`future crew fixture booking failed: ${booking.reason}`);
  return { tripId: trip.id, uncrewedTripId: emptyTrip.id, issueDate };
}
