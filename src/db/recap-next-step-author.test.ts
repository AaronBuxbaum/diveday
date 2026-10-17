import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordCourseNextStep } from "./course-next-step";
import { getRecapPageData } from "./recap";
import { bookings, people, shops } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/**
 * **The next step's author is read inside the booking's shop** (security
 * review of layer r4-6, note 2). Every other read on the recap re-proves the
 * shop; a staff record another shop holds must never put its name under an
 * instructor's words on a diver's recap.
 */
describe("the course recap's next-step author", () => {
  it("never prints the name of a person another shop holds", async () => {
    const { db, shop } = ctx;
    const all = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const session = all.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
    if (!session) throw new Error("the seeded shop is missing its course session");
    const [student] = await getTripRoster(db, shop.id, session.id);
    if (!student) throw new Error("the seeded course session has an empty roster");
    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("the seeded shop has no staff");
    const bookingId = student.booking.id;

    await recordCourseNextStep(db, {
      shopId: shop.id,
      bookingId,
      instructorPersonId: staff.person.id,
      note: "Book your deep dive before the card arrives.",
    });
    expect((await getRecapPageData(db, bookingId))?.course?.nextStep?.byName).toBeTruthy();

    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-recap-author", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const [stranger] = await db
      .insert(people)
      .values({ shopId: other.id, fullName: "Stranger Elsewhere" })
      .returning();
    if (!stranger) throw new Error("other shop's person insert failed");
    await db
      .update(bookings)
      .set({ courseNextStepByPersonId: stranger.id })
      .where(eq(bookings.id, bookingId));

    expect((await getRecapPageData(db, bookingId))?.course?.nextStep).toBeNull();
  });
});
