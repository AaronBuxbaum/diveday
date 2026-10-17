import { desc, eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { recordRollCall } from "./manifests";
import { rollCallEvents } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const state = vi.hoisted(() => ({ fail: false }));

vi.mock("./readiness", async (importActual) => {
  const actual = await importActual<typeof import("./readiness")>();
  return {
    ...actual,
    getBookingReadiness: (...args: Parameters<typeof actual.getBookingReadiness>) => {
      if (state.fail) throw new Error("readiness engine fell over");
      return actual.getBookingReadiness(...args);
    },
  };
});

const ctx = fileScopedShopContext();

/**
 * **The snapshot is a record, never a gate** (ADR 20261015-roll-call-records-
 * readiness, issue #2414 review). If reading readiness throws at an after-dive
 * checkpoint, the head count is still written, with no snapshot: a count of
 * bodies on the boat is the number that says nobody was left in the water.
 */
describe("a readiness read that throws at an after-dive count", () => {
  it("still records the count aboard, with a null snapshot", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef"));
    if (!trip) throw new Error("reef trip missing");
    const roster = await getTripRoster(db, shop.id, trip.id);
    const [staff] = await listStaff(db, shop.id);
    const booking = roster[0]?.booking;
    if (!booking || !staff) throw new Error("fixture missing a booking or a staffer");
    const base = {
      shopId: shop.id,
      tripId: trip.id,
      bookingId: booking.id,
      recordedByPersonId: staff.person.id,
    };
    // The dock count, before the engine is made to fail.
    await db.insert(rollCallEvents).values({
      ...base,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: new Date(trip.startsAt),
    });

    state.fail = true;
    try {
      const recorded = await recordRollCall(db, {
        ...base,
        status: "boarded",
        checkpoint: "after_dive_1",
      });
      expect(recorded.ok).toBe(true);
    } finally {
      state.fail = false;
    }

    const [row] = await db
      .select({
        status: rollCallEvents.status,
        checkpoint: rollCallEvents.checkpoint,
        readinessStatus: rollCallEvents.readinessStatus,
        readinessBlockers: rollCallEvents.readinessBlockers,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, booking.id))
      .orderBy(desc(rollCallEvents.seq))
      .limit(1);
    expect(row).toEqual({
      status: "boarded",
      checkpoint: "after_dive_1",
      readinessStatus: null,
      readinessBlockers: null,
    });
  });

  it("still refuses the dock count when the read throws, rather than boarding unchecked", async () => {
    const { db, shop } = ctx;
    const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
    const trip = trips.find((candidate) => candidate.title.startsWith("Two-Tank Reef"));
    if (!trip) throw new Error("reef trip missing");
    const roster = await getTripRoster(db, shop.id, trip.id);
    const [staff] = await listStaff(db, shop.id);
    const booking = roster[0]?.booking;
    if (!booking || !staff) throw new Error("fixture missing a booking or a staffer");
    state.fail = true;
    try {
      await expect(
        recordRollCall(db, {
          shopId: shop.id,
          tripId: trip.id,
          bookingId: booking.id,
          recordedByPersonId: staff.person.id,
          status: "boarded",
        }),
      ).rejects.toThrow("readiness engine fell over");
    } finally {
      state.fail = false;
    }
  });
});
