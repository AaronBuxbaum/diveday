import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppDb } from "@/db/client";
import { rollCallEventClaims, shops, tripScheduleDays, trips } from "@/db/schema";
import { meetingWindowsByTrip } from "@/db/trip-meeting-windows";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import { inHorizonReadiness } from "../blockers/store";
import { shopClock } from "../shop-clock/rules";
import { getDayCloseout } from "./closeout-reader";
import { getShopDayDepartures, getTodayWork, todaysDepartures } from "./today-reader";

/**
 * **A two-day course under 24 hours is still two days** (#2557): Saturday
 * 14:00-18:00 and Sunday 08:00-10:00 New York is 20 hours end to end, and
 * Sunday's card, readiness and boat must not vanish for being short.
 */
const ZONE = "America/New_York";
const ctx = fileScopedShopContext();
const SAT = { start: "2026-08-01T18:00:00.000Z", end: "2026-08-01T22:00:00.000Z" };
const SUN = { start: "2026-08-02T12:00:00.000Z", end: "2026-08-02T14:00:00.000Z" };

beforeEach(() => vi.stubEnv("DIVEDAY_CLOCK", "2026-08-01T14:00:00.000Z"));
afterEach(() => vi.unstubAllEnvs());

async function course(db: AppDb) {
  const [s] = await db
    .insert(shops)
    .values({ name: "Short Course Divers", slug: "md-short", timezone: ZONE })
    .returning();
  const [trip] = await db
    .insert(trips)
    .values({
      shopId: s?.id ?? "",
      title: "Open Water, weekend",
      startsAt: new Date(SAT.start),
      endsAt: new Date(SUN.end),
      capacity: 6,
    })
    .returning();
  if (!s || !trip) throw new Error("fixture failed");
  await db.insert(tripScheduleDays).values([
    { tripId: trip.id, dayNumber: 1, startsAt: new Date(SAT.start), endsAt: new Date(SAT.end) },
    { tripId: trip.id, dayNumber: 2, startsAt: new Date(SUN.start), endsAt: new Date(SUN.end) },
  ]);
  return { shop: s, trip };
}

describe("a two-day course shorter than 24 hours", () => {
  it("shows retained safety evidence on both meeting-day cards", async () => {
    const { db } = ctx;
    const { shop, trip } = await course(db);
    await db.insert(rollCallEventClaims).values({
      shopId: shop.id,
      tripId: trip.id,
      clientEventId: crypto.randomUUID(),
      state: "erased",
      retainedSafetyEvidence: {
        version: 1,
        receiptId: crypto.randomUUID(),
        checkpoint: "departure",
        status: "not_boarded",
        occurredAt: SAT.start,
        meetingDay: 1,
        observedEvidenceIds: [],
        retractsEventId: null,
        retractsClientEventId: null,
        reconcilesEvidence: false,
        noteRetained: false,
      },
    });
    const now = new Date("2026-08-01T14:00:00.000Z");
    const evidence = await inHorizonReadiness(db, shop.id, now);
    const today = await getTodayWork(
      db,
      shop.id,
      shop.slug,
      shopClock(shop, now),
      undefined,
      staffTranslator("en-US"),
      undefined,
      false,
      evidence,
    );
    const tomorrow = await getShopDayDepartures(db, shop.id, ZONE, new Date(SUN.start), evidence);
    expect(today.retainedSafetyUnresolved).toBe(true);
    expect(today.departures.find((departure) => departure.tripId === trip.id)).toMatchObject({
      retainedSafetyUnresolved: true,
    });
    expect(tomorrow.find((departure) => departure.tripId === trip.id)).toMatchObject({
      retainedSafetyUnresolved: true,
    });
    const closeout = await getDayCloseout(db, shop.id, ZONE, now);
    expect(closeout.departures.find((departure) => departure.tripId === trip.id)).toMatchObject({
      retainedSafetyUnresolved: true,
      booked: 0,
    });
  });

  it("reads both meeting windows", async () => {
    const { db } = ctx;
    const { trip } = await course(db);
    expect(trip.endsAt.getTime() - trip.startsAt.getTime()).toBeLessThan(24 * 3_600_000);
    expect((await meetingWindowsByTrip(db, [trip])).get(trip.id)).toHaveLength(2);
  });

  it("is Sunday's boat on every reader, at its start and two hours in", async () => {
    const { db } = ctx;
    const { shop: s, trip } = await course(db);
    for (const instant of ["2026-08-02T12:30:00.000Z", "2026-08-02T13:30:00.000Z"]) {
      const at = new Date(instant);
      vi.stubEnv("DIVEDAY_CLOCK", instant);
      const clock = shopClock({ timezone: ZONE }, at);
      const evidence = await inHorizonReadiness(db, s.id, at);
      expect(
        evidence.trips.map((t) => t.id),
        instant,
      ).toEqual([trip.id]);
      const work = await getTodayWork(
        db,
        s.id,
        s.slug,
        clock,
        undefined,
        staffTranslator("en-US"),
        undefined,
        false,
        evidence,
      );
      const day = await getShopDayDepartures(db, s.id, ZONE, at, evidence);
      const board = await todaysDepartures(db, s.id, clock);
      expect(
        work.departures.map((d) => d.tripId),
        instant,
      ).toEqual([trip.id]);
      expect(
        day.map((d) => d.tripId),
        instant,
      ).toEqual([trip.id]);
      expect(
        board.map((d) => d.id),
        instant,
      ).toEqual([trip.id]);
    }
  });
});
