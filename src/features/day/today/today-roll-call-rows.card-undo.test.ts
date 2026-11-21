import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createPerson } from "@/db/people";
import {
  createCertification,
  reviewCertification,
  unreviewCertification,
  upsertTripRequirements,
} from "@/db/readiness";
import { bookings as bookingsTable } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import {
  boardAtDeparture,
  returnedTrip,
} from "../../../test/substrate-fixtures/db/roll-call-test-fixtures";
import { shopClock } from "../shop-clock";
import { getTodayWork } from "./today-reader";

const EN = staffTranslator("en-US");
const ctx = fileScopedShopContext();

/**
 * **An undone card review reaches a diver already on the boat** (dive-domain
 * review of the test-suite layer 1). A staffer verified the card, the diver
 * boarded on it, and the staffer then taps Undo: the diver is aboard with a
 * certification nobody has checked, and Today has to say so while the boat is
 * out, not only on their next departure.
 */
describe("a card review undone after the diver boarded", () => {
  it("raises a blocked_aboard certification row while the boat is out", async () => {
    const { db, shop } = ctx;
    const { trip, bookingIds, staffId } = await returnedTrip(db, shop.id, {
      endedHoursAgo: -2.5,
      divers: 1,
      title: "Undone Review — Molasses",
    });
    const [bookingId] = bookingIds;
    if (!bookingId) throw new Error("fixture booking missing");
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: trip.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    // This case needs a diver whose only qualifying card is the one under review.
    // The shared fixture otherwise picks an unordered demo person, who may already
    // have a verified card that independently clears the requirement.
    const diver = await createPerson(db, {
      shopId: shop.id,
      fullName: "Card review diver",
      email: null,
      phone: null,
      origin: "counter",
    });
    await db
      .update(bookingsTable)
      .set({ personId: diver.id })
      .where(eq(bookingsTable.id, bookingId));
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: diver.id,
      agency: "padi",
      level: "rescue",
      identifier: "PADI-RESCUE-ABOARD",
    });
    if (!card) throw new Error("expected certification to insert");
    const reviewed = await reviewCertification(db, {
      shopId: shop.id,
      certificationId: card.id,
      status: "verified",
    });
    await boardAtDeparture(
      db,
      { shopId: shop.id, tripId: trip.id, staffId, bookingIds },
      new Date(trip.startsAt.getTime() + 5 * 60 * 1000),
    );
    const aboardRows = async () =>
      (await getTodayWork(db, shop.id, shop.slug, shopClock(shop), undefined, EN)).actions.filter(
        (action) => action.departure?.tripId === trip.id && action.kind === "blocked_aboard",
      );
    // Cleared on the card: nothing to say about them aboard.
    expect(await aboardRows()).toEqual([]);

    expect(
      await unreviewCertification(db, {
        shopId: shop.id,
        certificationId: card.id,
        reviewedAt:
          reviewed.ok && reviewed.certification.reviewedAt
            ? reviewed.certification.reviewedAt
            : new Date(0),
      }),
    ).toEqual({
      ok: true,
    });

    const rows = await aboardRows();
    expect(rows.map((row) => row.id)).toEqual([`blocker:${bookingId}:certification_pending`]);
  });
});
