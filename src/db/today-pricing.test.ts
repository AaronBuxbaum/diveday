import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { inHorizonReadiness } from "./blockers";
import { courses, trips as tripsTable } from "./schema";
import { getShopDayDepartures, listRollCallGaps } from "./today";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

describe("Today course pricing", () => {
  it("prices a course departure at the course total rather than its trip fee", async () => {
    const { db, shop } = ctx;
    const session = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.course);
    if (!session?.course) throw new Error("seeded course session missing");
    await db
      .update(courses)
      .set({ priceCents: 10_000, eLearningPriceCents: 2_500 })
      .where(eq(courses.id, session.course.id));
    await db.update(tripsTable).set({ priceCents: 19_500 }).where(eq(tripsTable.id, session.id));
    const now = new Date(session.startsAt.getTime() - 30 * 60 * 1000);
    const evidence = await inHorizonReadiness(db, shop.id, now);
    const departures = await getShopDayDepartures(db, shop.id, shop.timezone, now, evidence);
    expect(departures.find((trip) => trip.tripId === session.id)?.priceCents).toBe(12_500);
    await db
      .update(courses)
      .set({ priceCents: null, eLearningPriceCents: null })
      .where(eq(courses.id, session.course.id));
    const unpriced = await inHorizonReadiness(db, shop.id, now);
    expect(
      (await getShopDayDepartures(db, shop.id, shop.timezone, now, unpriced)).find(
        (trip) => trip.tripId === session.id,
      )?.priceCents,
    ).toBe(19_500);
    await db
      .update(courses)
      .set({ eLearningPriceCents: 2_500 })
      .where(eq(courses.id, session.course.id));
    const elearning = await inHorizonReadiness(db, shop.id, now);
    expect(
      (await getShopDayDepartures(db, shop.id, shop.timezone, now, elearning)).find(
        (trip) => trip.tripId === session.id,
      )?.priceCents,
    ).toBe(22_000);
  });

  it("does not price a rehearsal linked to a course", async () => {
    const { db, shop } = ctx;
    const session = (await upcomingTripsWithCounts(db, shop.id)).find((trip) => trip.course);
    if (!session?.course) throw new Error("seeded course session missing");
    await db.update(courses).set({ priceCents: 10_000 }).where(eq(courses.id, session.course.id));
    await db
      .update(tripsTable)
      .set({ isRehearsal: true, isPrivate: true, priceCents: null })
      .where(eq(tripsTable.id, session.id));
    const now = new Date(session.startsAt.getTime() - 30 * 60 * 1000);
    const evidence = await inHorizonReadiness(db, shop.id, now);
    const departures = await getShopDayDepartures(db, shop.id, shop.timezone, now, evidence);
    expect(departures.find((trip) => trip.tripId === session.id)?.priceCents).toBeNull();
  });

  it("keeps the trip fee for a departure without a course", async () => {
    const { db, shop } = ctx;
    const trip = (await upcomingTripsWithCounts(db, shop.id)).find((row) => !row.course);
    if (!trip) throw new Error("seeded non-course departure missing");
    await db.update(tripsTable).set({ priceCents: 19_500 }).where(eq(tripsTable.id, trip.id));
    const now = new Date(trip.startsAt.getTime() - 30 * 60 * 1000);
    const evidence = await inHorizonReadiness(db, shop.id, now);
    const departures = await getShopDayDepartures(db, shop.id, shop.timezone, now, evidence);
    expect(departures.find((row) => row.tripId === trip.id)?.priceCents).toBe(19_500);
  });

  it("uses the course total on a course departure's open roll call", async () => {
    const { db, shop } = ctx;
    const session = (await upcomingTripsWithCounts(db, shop.id)).find(
      (trip) => trip.course && trip.booked > 0,
    );
    if (!session?.course) throw new Error("seeded booked course session missing");
    const now = new Date(session.endsAt.getTime() + 61 * 60_000);
    const before = await listRollCallGaps(db, shop.id, now, [session.id], { historical: true });
    await db
      .update(courses)
      .set({ priceCents: 10_000, eLearningPriceCents: 2_500 })
      .where(eq(courses.id, session.course.id));
    await db.update(tripsTable).set({ priceCents: 19_500 }).where(eq(tripsTable.id, session.id));
    const gaps = await listRollCallGaps(db, shop.id, now, [session.id], { historical: true });
    expect(gaps.find((trip) => trip.tripId === session.id)?.priceCents).toBe(12_500);
    expect(
      gaps.map(({ reason, diveNumber, uncounted, awaiting, total }) => ({
        reason,
        diveNumber,
        uncounted,
        awaiting,
        total,
      })),
    ).toEqual(
      before.map(({ reason, diveNumber, uncounted, awaiting, total }) => ({
        reason,
        diveNumber,
        uncounted,
        awaiting,
        total,
      })),
    );
    await db
      .update(courses)
      .set({ priceCents: null, eLearningPriceCents: null })
      .where(eq(courses.id, session.course.id));
    expect(
      (await listRollCallGaps(db, shop.id, now, [session.id], { historical: true })).find(
        (trip) => trip.tripId === session.id,
      )?.priceCents,
    ).toBe(19_500);
    await db.update(courses).set({ priceCents: 10_000 }).where(eq(courses.id, session.course.id));
    await db
      .update(tripsTable)
      .set({ isRehearsal: true, isPrivate: true, priceCents: null })
      .where(eq(tripsTable.id, session.id));
    const rehearsalGaps = await listRollCallGaps(db, shop.id, now, [session.id], {
      historical: true,
    });
    expect(rehearsalGaps.find((trip) => trip.tripId === session.id)?.priceCents).toBeNull();
  });
});
