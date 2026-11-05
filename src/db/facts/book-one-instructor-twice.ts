import { eq } from "drizzle-orm";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { courses, tripAssignments } from "@/db/schema";
import { createTrip, listStaff } from "@/db/trips";
import { HOUR_MS } from "@/lib/clock";

/**
 * **One instructor on two course sessions at the same hour** (`mixedTraining`):
 * an intro session and an Open Water session, one student enrolled, so the
 * overlap is the instructor's to resolve.
 */
export async function bookOneInstructorTwice(db: AppDb, shop: { id: string }, now: Date) {
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  // The demo seeds two intro courses; an unordered read returned either one,
  // whichever the planner liked (#2737). By title, it is always the same one.
  const intro = catalog
    .filter((course) => course.isIntroCourse)
    .sort((a, b) => a.title.localeCompare(b.title, "en"))[0];
  const entry = catalog.find(
    (course) =>
      !course.isIntroCourse &&
      course.agency.toLowerCase() === "padi" &&
      !course.minimumCertificationLevel,
  );
  const instructor = (await listStaff(db, shop.id)).find((person) =>
    person.roles.includes("instructor"),
  );
  if (!intro || !entry || !instructor)
    throw new Error("mixed training fixture needs courses and an instructor");
  const startsAt = new Date(now.getTime() + 48 * HOUR_MS);
  const make = (courseId: string, title: string) =>
    createTrip(db, {
      shopId: shop.id,
      courseId,
      title,
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 8,
      plannedDives: 1,
    });
  const a = await make(intro.id, "Intro session");
  const b = await make(entry.id, "Open Water session");
  if (!a || !b) throw new Error("mixed training fixture sessions missing");
  await db.insert(tripAssignments).values([
    { tripId: a.id, personId: instructor.person.id },
    { tripId: b.id, personId: instructor.person.id },
  ]);
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: b.id,
    fullName: "Training student",
    email: "training-student@example.test",
  });
  if (!booking.ok) throw new Error(`mixed training fixture enrollment failed: ${booking.reason}`);
  return { tripId: a.id, otherTripId: b.id };
}
