// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { DAY_MS, HOUR_MS } from "@/lib/clock";
import { emptyMedicalAnswers, RSTC_QUESTIONNAIRE } from "@/lib/medical";
import { WAIVER_SIGNATURE_VALIDITY_MS } from "@/lib/waivers";
import { fileScopedShopContext } from "@/test/db";
import { listTripsReadiness, upsertTripRequirements } from "./readiness";
import { trips, waiverRecords } from "./schema";
import { getTripRoster, upcomingTripsWithCounts } from "./trips";
import { completeWaiver, issueWaiverRequest } from "./waivers";

const ctx = fileScopedShopContext();

/**
 * **A release's clocks run at the departure** (issue #2611). The roster is read
 * at `now`, and the signature's year (and a cleared referral's physician year)
 * is measured at the later of `now` and the departure: a release that lapses
 * before the boat leaves reads blocked days ahead, and nothing reads blocked
 * for a lapse that comes after the trip is over.
 */
async function signedReefSeat() {
  const { db, shop } = ctx;
  const upcoming = await upcomingTripsWithCounts(db, shop.id, new Date(0));
  const reef = upcoming.find((trip) => trip.title.startsWith("Two-Tank Reef — Molasses"));
  if (!reef) throw new Error("demo reef trip missing");
  const [entry] = await getTripRoster(db, shop.id, reef.id);
  if (!entry) throw new Error("demo booking missing");
  await upsertTripRequirements(db, {
    shopId: shop.id,
    tripId: reef.id,
    requiresWaiver: true,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresPayment: false,
  });
  const issued = await issueWaiverRequest(db, { shopId: shop.id, bookingId: entry.booking.id });
  if (!issued.ok) throw new Error(`waiver issue failed: ${issued.reason}`);
  const done = await completeWaiver(db, issued.token, {
    signerName: entry.person.fullName,
    agreed: true,
    medicalAnswers: emptyMedicalAnswers(RSTC_QUESTIONNAIRE),
  });
  if (!done.ok) throw new Error("waiver completion failed");
  return { db, shop, reef, entry };
}

/** Re-date every signed release of the diver so it lapses at `lapsesAt`. */
async function lapseAt(
  seat: Awaited<ReturnType<typeof signedReefSeat>>,
  lapsesAt: Date,
): Promise<void> {
  const signedAt = new Date(lapsesAt.getTime() - WAIVER_SIGNATURE_VALIDITY_MS);
  await seat.db
    .update(waiverRecords)
    .set({ signedAt, completedAt: signedAt })
    .where(eq(waiverRecords.personId, seat.entry.person.id));
}

async function blockersAt(seat: Awaited<ReturnType<typeof signedReefSeat>>, now: Date) {
  const rows = await listTripsReadiness(seat.db, seat.shop.id, [seat.reef.id], now);
  const row = rows.find((r) => r.booking.id === seat.entry.booking.id);
  if (!row) throw new Error("seat missing from the roster");
  return row.readiness;
}

describe("a release that lapses before the departure", () => {
  it("reads blocked as a lapsed release the night before a morning departure", async () => {
    const seat = await signedReefSeat();
    const startsAt = seat.reef.startsAt;
    await lapseAt(seat, new Date(startsAt.getTime() - 2 * HOUR_MS));

    const readiness = await blockersAt(seat, new Date(startsAt.getTime() - 14 * HOUR_MS));
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.map((b) => b.code)).toEqual(["waiver_lapsed"]);
  });

  it("stays ready when the release outlasts the departure", async () => {
    const seat = await signedReefSeat();
    const startsAt = seat.reef.startsAt;
    await lapseAt(seat, new Date(startsAt.getTime() + 2 * HOUR_MS));

    const readiness = await blockersAt(seat, new Date(startsAt.getTime() - 14 * HOUR_MS));
    expect(readiness).toEqual({ status: "ready", blockers: [] });
  });

  it("never measures earlier than now: a release that lapsed yesterday still reads lapsed", async () => {
    const seat = await signedReefSeat();
    const startsAt = seat.reef.startsAt;
    await lapseAt(seat, new Date(startsAt.getTime() - DAY_MS));

    const readiness = await blockersAt(seat, new Date(startsAt.getTime() - 2 * HOUR_MS));
    expect(readiness.blockers.map((b) => b.code)).toEqual(["waiver_lapsed"]);
  });

  it("blocks a liveaboard whose release lapses mid-trip before it sails", async () => {
    const seat = await signedReefSeat();
    const startsAt = seat.reef.startsAt;
    const endsAt = new Date(startsAt.getTime() + 4 * DAY_MS);
    await seat.db.update(trips).set({ endsAt }).where(eq(trips.id, seat.reef.id));
    await lapseAt(seat, new Date(startsAt.getTime() + 2 * DAY_MS));

    const readiness = await blockersAt(seat, new Date(startsAt.getTime() - 6 * HOUR_MS));
    expect(readiness.status).toBe("blocked");
    expect(readiness.blockers.map((b) => b.code)).toEqual(["waiver_lapsed"]);
  });

  it("clears a liveaboard whose release outlasts its return", async () => {
    const seat = await signedReefSeat();
    const startsAt = seat.reef.startsAt;
    const endsAt = new Date(startsAt.getTime() + 4 * DAY_MS);
    await seat.db.update(trips).set({ endsAt }).where(eq(trips.id, seat.reef.id));
    await lapseAt(seat, new Date(endsAt.getTime() + HOUR_MS));

    const readiness = await blockersAt(seat, new Date(startsAt.getTime() - 6 * HOUR_MS));
    expect(readiness).toEqual({ status: "ready", blockers: [] });
  });
});
