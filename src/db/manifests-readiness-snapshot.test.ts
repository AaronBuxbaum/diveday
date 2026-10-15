import { desc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { listCountedAboardBlockedByTrip, recordRollCall } from "./manifests";
import {
  createSpecialtyCertification,
  getBookingReadiness,
  reviewSpecialtyCertification,
} from "./readiness";
import { rollCallEvents } from "./schema";
import { getTripRoster, listStaff, upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

/**
 * **A roll-call event keeps what readiness said when it was written** (issue
 * #2414), so a finished departure's record can say who was counted aboard while
 * blocked after the card is later cleared. A record, never a gate: the
 * departure still refuses a blocked boarding exactly as before.
 */

async function seat(titlePrefix: string, wanting?: "ready") {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const trip = trips.find((candidate) => candidate.title.startsWith(titlePrefix));
  if (!trip) throw new Error(`${titlePrefix} trip missing`);
  const roster = await getTripRoster(db, shop.id, trip.id);
  let booking: (typeof roster)[number] | undefined = roster[0];
  if (wanting === "ready") {
    booking = undefined;
    for (const entry of roster) {
      const reading = await getBookingReadiness(db, shop.id, entry.booking.id);
      if (reading?.status === "ready") {
        booking = entry;
        break;
      }
    }
  }
  const [staff] = await listStaff(db, shop.id);
  if (!booking || !staff) throw new Error("fixture missing a booking or a staffer");
  const base = {
    shopId: shop.id,
    tripId: trip.id,
    bookingId: booking.booking.id,
    recordedByPersonId: staff.person.id,
  };
  const newest = async () => {
    const [row] = await db
      .select({
        status: rollCallEvents.readinessStatus,
        blockers: rollCallEvents.readinessBlockers,
      })
      .from(rollCallEvents)
      .where(eq(rollCallEvents.bookingId, booking.booking.id))
      .orderBy(desc(rollCallEvents.seq))
      .limit(1);
    return row;
  };
  /** The dock count of a blocked diver, as the crew's earlier boat left it (the gate refuses it live). */
  const boardAtDock = () =>
    db.insert(rollCallEvents).values({
      ...base,
      status: "boarded",
      checkpoint: "departure",
      source: "live",
      occurredAt: new Date(trip.startsAt),
    });
  return { db, shop, trip, booking, base, newest, boardAtDock };
}

describe("a roll-call event keeps what readiness said", () => {
  it("keeps `blocked` and its blockers for a diver counted aboard at an after-dive checkpoint", async () => {
    const { db, shop, trip, base, newest, boardAtDock } = await seat("Night Dive");
    await boardAtDock();
    const recorded = await recordRollCall(db, {
      ...base,
      status: "boarded",
      checkpoint: "after_dive_1",
    });
    expect(recorded.ok).toBe(true);

    const row = await newest();
    expect(row?.status).toBe("blocked");
    expect(row?.blockers?.length).toBeGreaterThan(0);
    const said = await listCountedAboardBlockedByTrip(db, shop.id, [trip.id]);
    expect(said.get(trip.id)?.get(base.bookingId)).toMatchObject({
      checkpoint: "after_dive_1",
      blockers: row?.blockers,
    });
  });

  it("keeps `ready` and no blockers for a cleared diver boarded at the dock", async () => {
    const { db, shop, trip, base, newest } = await seat("Two-Tank Reef", "ready");
    const recorded = await recordRollCall(db, { ...base, status: "boarded" });
    expect(recorded.ok).toBe(true);
    const row = await newest();
    expect(row).toEqual({ status: "ready", blockers: null });
    expect((await listCountedAboardBlockedByTrip(db, shop.id, [trip.id])).size).toBe(0);
  });

  it("still refuses to board a blocked diver at the dock, snapshot or not", async () => {
    const { db, base } = await seat("Night Dive");
    await expect(recordRollCall(db, { ...base, status: "boarded" })).resolves.toEqual({
      ok: false,
      reason: "not_ready",
    });
  });

  it("stores nothing on a not-boarded or cleared event", async () => {
    const { db, base, newest } = await seat("Night Dive");
    await recordRollCall(db, { ...base, status: "not_boarded" });
    expect(await newest()).toEqual({ status: null, blockers: null });
    await recordRollCall(db, { ...base, status: "cleared" });
    expect(await newest()).toEqual({ status: null, blockers: null });
  });

  it("drops the line when the crew's newest word at that checkpoint is a correction", async () => {
    const { db, shop, trip, base, boardAtDock } = await seat("Night Dive");
    await boardAtDock();
    await recordRollCall(db, { ...base, status: "boarded", checkpoint: "after_dive_1" });
    await recordRollCall(db, { ...base, status: "not_boarded", checkpoint: "after_dive_1" });
    expect((await listCountedAboardBlockedByTrip(db, shop.id, [trip.id])).size).toBe(0);
  });

  it("is not recomputed: the line stands after the card that was missing is verified", async () => {
    const { db, shop, trip, booking, base, boardAtDock } = await seat("Night Dive");
    await boardAtDock();
    await recordRollCall(db, { ...base, status: "boarded", checkpoint: "after_dive_1" });
    const before = await getBookingReadiness(db, shop.id, base.bookingId);
    const missing = before?.blockers.find((blocker) => blocker.code === "specialty_missing");
    // The night trip asks for a Night card the diver lacks; clearing exactly
    // that blocker is the "verified at 09:00 after a 05:30 boat" case.
    expect(missing).toBeDefined();
    const card = await createSpecialtyCertification(db, {
      shopId: shop.id,
      personId: booking.person.id,
      agency: "padi",
      specialty: "night",
      identifier: "PADI-NIGHT-SNAP",
    });
    if (!card) throw new Error("card insert failed");
    await reviewSpecialtyCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    const after = await getBookingReadiness(db, shop.id, base.bookingId);
    expect(after?.blockers.map((blocker) => blocker.code)).not.toContain("specialty_missing");

    const said = await listCountedAboardBlockedByTrip(db, shop.id, [trip.id]);
    expect(
      said
        .get(trip.id)
        ?.get(base.bookingId)
        ?.blockers.map((blocker) => blocker.code),
    ).toContain("specialty_missing");
  });

  it("refuses a snapshot on an event that is not a count aboard", async () => {
    const { db, base } = await seat("Night Dive");
    await expect(
      db.insert(rollCallEvents).values({
        ...base,
        status: "not_boarded",
        checkpoint: "departure",
        source: "live",
        occurredAt: nowDate(),
        readinessStatus: "blocked",
        readinessBlockers: [{ code: "certification_missing" }],
      }),
    ).rejects.toThrow();
  });
});
