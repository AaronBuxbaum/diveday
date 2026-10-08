import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordCourseMaterialsDone } from "./course-materials";
import { bookings } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

/**
 * **A staffer's tick that a student finished the course's learning materials**
 * (ADR 20261008-course-learning-materials). Bookkeeping, never a gate — and,
 * like the next step beside it, refused on a departure that teaches nothing.
 */
const ctx = fileScopedShopContext();
const OTHER_SHOP = "00000000-0000-4000-8000-0000000000ff";

async function courseContext() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const session = trips.find((trip) => trip.title.startsWith("Advanced Open Water Diver"));
  const funDive = trips.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!session || !funDive) throw new Error("the seeded shop is missing a course session");
  // The demo seed ticks a student already, and these tests tick more: each
  // starts from the same seat with nothing on it, so it stands alone.
  const [student] = await getTripRoster(db, shop.id, session.id);
  const [diver] = await getTripRoster(db, shop.id, funDive.id);
  if (!student || !diver) throw new Error("the seeded departures have empty rosters");
  await db
    .update(bookings)
    .set({ courseMaterialsDoneAt: null, courseMaterialsDoneByPersonId: null })
    .where(eq(bookings.id, student.booking.id));
  const [staff] = await listStaff(db, shop.id);
  if (!staff) throw new Error("the seeded shop has no staff");
  return {
    db,
    shop,
    staffId: staff.person.id,
    studentBookingId: student.booking.id,
    funDiveBookingId: diver.booking.id,
  };
}

const stored = async (db: Awaited<ReturnType<typeof courseContext>>["db"], bookingId: string) => {
  const [row] = await db
    .select({
      at: bookings.courseMaterialsDoneAt,
      by: bookings.courseMaterialsDoneByPersonId,
    })
    .from(bookings)
    .where(eq(bookings.id, bookingId));
  return row;
};

describe("recordCourseMaterialsDone", () => {
  it("stamps the moment and who ticked it", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const now = new Date("2026-10-08T15:00:00Z");
    expect(
      await recordCourseMaterialsDone(db, {
        shopId: shop.id,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        done: true,
        now,
      }),
    ).toEqual({ ok: true });
    expect(await stored(db, studentBookingId)).toEqual({ at: now, by: staffId });
  });

  it("keeps the first stamp when it is ticked again", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const base = { shopId: shop.id, bookingId: studentBookingId, staffPersonId: staffId };
    const first = new Date("2026-10-06T09:00:00Z");
    await recordCourseMaterialsDone(db, { ...base, done: true, now: first });
    await recordCourseMaterialsDone(db, {
      ...base,
      done: true,
      now: new Date("2026-10-08T09:00:00Z"),
    });
    expect((await stored(db, studentBookingId))?.at).toEqual(first);
  });

  it("clears both columns when the tick is taken back", async () => {
    // The pairing check is real under PGlite, so a half-clear fails here.
    const { db, shop, staffId, studentBookingId } = await courseContext();
    const base = { shopId: shop.id, bookingId: studentBookingId, staffPersonId: staffId };
    await recordCourseMaterialsDone(db, { ...base, done: true });
    expect(await recordCourseMaterialsDone(db, { ...base, done: false })).toEqual({ ok: true });
    expect(await stored(db, studentBookingId)).toEqual({ at: null, by: null });
  });

  it("refuses a departure that teaches no course, and writes nothing", async () => {
    const { db, shop, staffId, funDiveBookingId } = await courseContext();
    expect(
      await recordCourseMaterialsDone(db, {
        shopId: shop.id,
        bookingId: funDiveBookingId,
        staffPersonId: staffId,
        done: true,
      }),
    ).toEqual({ ok: false, reason: "not_a_course_session" });
    expect(await stored(db, funDiveBookingId)).toEqual({ at: null, by: null });
  });

  it("refuses another shop's booking id, and writes nothing", async () => {
    // Tenant isolation: holding a booking id is not holding the booking.
    const { db, staffId, studentBookingId } = await courseContext();
    expect(
      await recordCourseMaterialsDone(db, {
        shopId: OTHER_SHOP,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        done: true,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect(await stored(db, studentBookingId)).toEqual({ at: null, by: null });
  });

  it("refuses to clear another shop's tick", async () => {
    const { db, shop, staffId, studentBookingId } = await courseContext();
    await recordCourseMaterialsDone(db, {
      shopId: shop.id,
      bookingId: studentBookingId,
      staffPersonId: staffId,
      done: true,
    });
    expect(
      await recordCourseMaterialsDone(db, {
        shopId: OTHER_SHOP,
        bookingId: studentBookingId,
        staffPersonId: staffId,
        done: false,
      }),
    ).toEqual({ ok: false, reason: "not_found" });
    expect((await stored(db, studentBookingId))?.by).toBe(staffId);
  });
});
