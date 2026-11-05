import { eq } from "drizzle-orm";
import { createBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { bookings, courses } from "@/db/schema";
import { markTrainingDive } from "@/db/training-marks";
import { createTrip, listStaff } from "@/db/trips";
import { HOUR_MS } from "@/lib/clock";

/**
 * **A charter carrying two students of different courses** (`mixedDepth`),
 * each dive marked toward their own session, so the charter's training line
 * names two depths.
 */
export async function markTwoDepthsOnOneCharter(db: AppDb, shop: { id: string }, now: Date) {
  const catalog = await db.select().from(courses).where(eq(courses.shopId, shop.id));
  // The demo seeds two intro courses; an unordered read returned either one,
  // whichever the planner liked (#2737). By title, it is always the same one.
  const intro = catalog
    .filter((course) => course.isIntroCourse)
    .sort((a, b) => a.title.localeCompare(b.title, "en"))[0];
  // The same for the Open Water course, and seeded rows first: a course an
  // earlier test added (with its own forms and limits) must not take its place.
  const other = catalog
    .filter((course) => !course.isIntroCourse && course.certifiesLevel === "open_water")
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() || a.title.localeCompare(b.title, "en"),
    )[0];
  const owner = (await listStaff(db, shop.id)).find((person) => person.roles.includes("owner"));
  if (!intro || !other || !owner) throw new Error("mixed depth fixture needs courses and owner");
  const startsAt = new Date(now.getTime() + 48 * HOUR_MS);
  const endsAt = new Date(startsAt.getTime() + 4 * HOUR_MS);
  const make = (title: string, courseId?: string) =>
    createTrip(db, {
      shopId: shop.id,
      title,
      courseId,
      startsAt,
      endsAt,
      capacity: 8,
      plannedDives: 2,
    });
  const charter = await make("Mixed training charter");
  const introSession = await make("Intro session", intro.id);
  const otherSession = await make("Open Water session", other.id);
  if (!charter || !introSession || !otherSession) throw new Error("mixed depth departures missing");
  for (const [index, session] of [introSession, otherSession].entries()) {
    const seat = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: charter.id,
      fullName: index === 0 ? "Maya" : "Noah",
      email: `mixed-depth-${index}@example.test`,
    });
    if (!seat.ok) throw new Error(`mixed depth charter seat failed: ${seat.reason}`);
    const [enrollment] = await db
      .insert(bookings)
      .values({
        shopId: shop.id,
        tripId: session.id,
        personId: seat.personId,
        bookedAs: "diver",
      })
      .returning();
    if (!enrollment) throw new Error("mixed depth enrollment missing");
    const result = await markTrainingDive(db, {
      shopId: shop.id,
      bookingId: seat.bookingId,
      enrollmentBookingId: enrollment.id,
      actorPersonId: owner.person.id,
    });
    if (!result.ok) throw new Error(`mixed depth mark failed: ${result.reason}`);
  }
  return { tripId: charter.id };
}
