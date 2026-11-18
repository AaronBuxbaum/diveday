import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  createCertification,
  listTripReadiness,
  reviewCertification,
  unreviewCertification,
  upsertTripRequirements,
} from "@/db/readiness";
import { bookings as bookingsTable, people } from "@/db/schema";
import { staffTranslator } from "@/i18n/staff-messages";
import { fileScopedShopContext } from "@/test/db";
import {
  boardAtDeparture,
  returnedTrip,
} from "../../test/substrate-fixtures/db/roll-call-test-fixtures";
import { shopClock } from "../shop-clock/rules";
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
    // The general roll-call fixture selects an unordered seeded person. A
    // different verified card on that person can still satisfy this trip after
    // the card under test is unreviewed, so use a person with no other cards.
    const [diver] = await db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Undo review test diver" })
      .returning({ id: people.id });
    if (!diver) throw new Error("fixture diver missing");
    await db
      .update(bookingsTable)
      .set({ personId: diver.id })
      .where(eq(bookingsTable.id, bookingId));
    await upsertTripRequirements(db, {
      shopId: shop.id,
      tripId: trip.id,
      requiresWaiver: false,
      minimumCertificationLevel: "rescue",
      requiredSpecialties: [],
      requiresNitrox: false,
      requiresPayment: false,
    });
    const [seat] = await db
      .select({ personId: bookingsTable.personId })
      .from(bookingsTable)
      .where(eq(bookingsTable.id, bookingId));
    if (!seat) throw new Error("fixture seat missing");
    const card = await createCertification(db, {
      shopId: shop.id,
      personId: seat.personId,
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

    const readiness = await listTripReadiness(db, shop.id, trip.id);
    expect(readiness.find((row) => row.booking.id === bookingId)?.readiness.blockers).toEqual(
      expect.arrayContaining([expect.objectContaining({ code: "certification_pending" })]),
    );
    const rows = await aboardRows();
    expect(rows.map((row) => row.id)).toEqual([`blocker:${bookingId}:certification_pending`]);
  });
});
