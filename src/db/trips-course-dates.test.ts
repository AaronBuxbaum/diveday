import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { bookings, courses, trips } from "./schema";
import { createTrip, upcomingSessionsByCourse } from "./trips";

const ctx = fileScopedShopContext();
const now = new Date("2031-01-01T00:00:00Z");

describe("upcomingSessionsByCourse", () => {
  it("returns only three bookable dates per shop course, ordered and carrying seats", async () => {
    const { db, shop } = ctx;
    const [course] = await db.select().from(courses).where(eq(courses.shopId, shop.id)).limit(1);
    if (!course) throw new Error("seed course missing");
    const expected = [];
    for (let n = 0; n < 7; n++) {
      const startsAt = new Date(`2031-03-0${n + 1}T14:00:00Z`);
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: `Course date ${n}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 3600000),
        capacity: n === 2 ? 1 : 4,
        plannedDives: 2,
      });
      if (!trip) throw new Error("trip creation failed");
      await db
        .update(trips)
        .set({ courseId: course.id, isPrivate: n === 0, conditionsHold: n === 1 })
        .where(eq(trips.id, trip.id));
      if (n === 2) {
        const [booking] = await db
          .select()
          .from(bookings)
          .where(eq(bookings.shopId, shop.id))
          .limit(1);
        if (!booking) throw new Error("seed booking missing");
        const { id: _id, createdAt: _createdAt, partyLeadBookingId: _lead, ...copy } = booking;
        await db.insert(bookings).values({ ...copy, tripId: trip.id, status: "booked" });
      }
      if (n >= 3 && n <= 5) expected.push({ id: trip.id, startsAt, seatsLeft: 4 });
    }
    const result = await upcomingSessionsByCourse(db, shop.id, [course.id], now);
    expect(result.get(course.id)).toEqual(expected);
    expect(
      await upcomingSessionsByCourse(db, "00000000-0000-4000-8000-000000000000", [course.id], now),
    ).toEqual(new Map());
  });

  it("returns no dates without course IDs", async () => {
    expect(await upcomingSessionsByCourse(ctx.db, ctx.shop.id, [], now)).toEqual(new Map());
  });
});
