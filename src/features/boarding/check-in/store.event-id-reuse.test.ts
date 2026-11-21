import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { standingArrivalStatus } from "../../../db/arrival-provenance";
import { bookingArrivalEvents } from "../../../db/schema/index";
import { getTripRoster, listStaff } from "../../../db/trips";
import { upcomingTripsWithCounts } from "../../../db/trips-queries.test-support";
import { completeWaiver, issueWaiverRequest } from "../../../db/waivers";
import { nowDate } from "../../../lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "../../../lib/medical";
import { fileScopedShopContext } from "../../../test/db";
import { checkInBooking, undoCheckInBooking } from "./store";

const MINUTE = 60 * 1000;
const HOUR = 60 * MINUTE;
const ctx = fileScopedShopContext();

/** A seeded reef-trip seat whose waiver is signed, so readiness clears it. */
async function readySeat() {
  const { db, shop } = await ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const reef = trips.find((trip) => trip.title === "Two-Tank Reef — Molasses & French");
  if (!reef) throw new Error("seeded reef trip missing");
  const [staff] = await listStaff(db, shop.id);
  const [row] = await getTripRoster(db, shop.id, reef.id);
  if (!staff || !row) throw new Error("seeded staff or booking missing");
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: row.booking.id });
  if (!issued.ok) throw new Error("waiver request refused");
  await completeWaiver(db, issued.key, {
    signerName: row.person.fullName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  return { db, shop, staff: staff.person, booking: row.booking };
}

function queued(occurredAt: Date = new Date(nowDate().getTime() - 30 * MINUTE)) {
  return {
    source: "offline" as const,
    clientEventId: crypto.randomUUID(),
    occurredAt,
    offlineSnapshotSavedAt: new Date(occurredAt.getTime() - 10 * MINUTE),
  };
}

describe("an offline event id reused for a different operation", () => {
  it("refuses an undo that reuses the arrival's own event id, and leaves the diver arrived", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const arrival = queued(new Date(nowDate().getTime() - 3 * HOUR));
    await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...arrival,
    });

    const outcome = await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...arrival,
      occurredAt: new Date(nowDate().getTime() - MINUTE),
      retractsClientEventId: arrival.clientEventId,
    });

    expect(outcome).toEqual({ ok: false, reason: "snapshot_invalid" });
    expect(await standingArrivalStatus(db, shop.id, booking.tripId, booking.id)).toBe("arrived");
    const trail = await db
      .select()
      .from(bookingArrivalEvents)
      .where(eq(bookingArrivalEvents.bookingId, booking.id));
    expect(trail).toHaveLength(1);
  });

  it("refuses an arrival that reuses the event id of an undo", async () => {
    const { db, shop, staff, booking } = await readySeat();
    const arrival = queued(new Date(nowDate().getTime() - 3 * HOUR));
    await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...arrival,
    });
    const undo = queued(new Date(nowDate().getTime() - 2 * MINUTE));
    await undoCheckInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...undo,
      retractsClientEventId: arrival.clientEventId,
    });

    const outcome = await checkInBooking(db, {
      shopId: shop.id,
      bookingId: booking.id,
      recordedByPersonId: staff.id,
      ...undo,
      occurredAt: new Date(nowDate().getTime() - MINUTE),
    });

    expect(outcome).toEqual({ ok: false, reason: "snapshot_invalid" });
    expect(await standingArrivalStatus(db, shop.id, booking.tripId, booking.id)).toBe("cleared");
  });
});
