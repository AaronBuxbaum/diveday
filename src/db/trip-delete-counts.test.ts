import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { countDeparturesByBoat, createBoat } from "./boats";
import { createBooking } from "./bookings";
import { bookings, rollCallCrewEvents, rollCallEvents, tripAssignments, trips } from "./schema";
import { countDeparturesByTripLens, createTripLens } from "./trip-lenses";
import { getTripRoster, listStaff } from "./trips";
import { createTrip } from "./trips-create";

const ctx = fileScopedShopContext();

describe("boat and trip-tag deletion counts", () => {
  it("counts cancelled trips only when a latest diver or crew result says someone sailed", async () => {
    const { db, shop } = ctx;
    const boat = await createBoat(db, shop.id, "Sailing history", 8);
    const lens = await createTripLens(db, shop.id, "Sailing evidence");
    if (!lens) throw new Error("trip tag creation failed");
    const lensId = lens.id;

    const [staff] = await listStaff(db, shop.id);
    if (!staff) throw new Error("expected seeded staff");

    let day = 1;
    async function targetTrip(label: string) {
      const startsAt = new Date(Date.UTC(2030, 4, day++, 9));
      const trip = await createTrip(db, {
        shopId: shop.id,
        title: `Delete count ${label}`,
        startsAt,
        endsAt: new Date(startsAt.getTime() + 4 * 3600 * 1000),
        capacity: 8,
        plannedDives: 2,
        priceCents: 10000,
        diveMode: "boat",
        boatId: boat.id,
      });
      if (!trip) throw new Error(`trip creation failed: ${label}`);

      const created = await createBooking(db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName: `Delete Count ${label}`,
        email: `delete-count-${label.toLowerCase()}@example.test`,
      });
      if (!created.ok) throw new Error(`booking creation failed: ${label}`);
      const [seat] = await getTripRoster(db, shop.id, trip.id);
      if (!seat) throw new Error(`booking roster missing: ${label}`);

      await db.update(trips).set({ lensId }).where(eq(trips.id, trip.id));
      return { trip, bookingId: seat.booking.id };
    }

    async function diverResult(
      tripId: string,
      bookingId: string,
      status: "boarded" | "not_boarded" | "cleared",
      checkpoint: string,
      minute: number,
    ) {
      await db.insert(rollCallEvents).values({
        shopId: shop.id,
        tripId,
        bookingId,
        recordedByPersonId: staff.person.id,
        status,
        checkpoint,
        occurredAt: new Date(Date.UTC(2030, 5, 1, 9, minute)),
      });
    }

    async function cancelTrip(tripId: string) {
      await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, tripId));
    }

    // Every non-cancelled trip still counts, regardless of roll-call evidence.
    await targetTrip("scheduled");

    // A cancelled trip with no roll-call evidence is not counted.
    const noEvidence = await targetTrip("no-evidence");
    await cancelTrip(noEvidence.trip.id);

    // A departure no-show by itself does not prove the boat sailed.
    const dockNoShow = await targetTrip("departure-no-show");
    await diverResult(dockNoShow.trip.id, dockNoShow.bookingId, "not_boarded", "departure", 1);
    await cancelTrip(dockNoShow.trip.id);

    // A standing boarded result remains evidence after both status words change.
    const diverBoarded = await targetTrip("diver-boarded");
    await diverResult(diverBoarded.trip.id, diverBoarded.bookingId, "boarded", "after_dive_1", 2);
    await db
      .update(bookings)
      .set({ status: "cancelled" })
      .where(eq(bookings.id, diverBoarded.bookingId));
    await cancelTrip(diverBoarded.trip.id);

    // The latest result at this checkpoint is a retraction, so the older mark no longer counts.
    const corrected = await targetTrip("cleared");
    await diverResult(corrected.trip.id, corrected.bookingId, "boarded", "departure", 3);
    await diverResult(corrected.trip.id, corrected.bookingId, "cleared", "departure", 4);
    await cancelTrip(corrected.trip.id);

    // An after-dive not-boarded result means the diver made the departure.
    const diverAfterDive = await targetTrip("diver-after-dive");
    await diverResult(
      diverAfterDive.trip.id,
      diverAfterDive.bookingId,
      "not_boarded",
      "after_dive_1",
      5,
    );
    await cancelTrip(diverAfterDive.trip.id);

    // The crew trail uses the same sailed rule as the diver trail.
    const crewAfterDive = await targetTrip("crew-after-dive");
    await db
      .insert(tripAssignments)
      .values({ tripId: crewAfterDive.trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    await db.insert(rollCallCrewEvents).values({
      shopId: shop.id,
      tripId: crewAfterDive.trip.id,
      personId: staff.person.id,
      recordedByPersonId: staff.person.id,
      status: "not_boarded",
      checkpoint: "after_dive_1",
      occurredAt: new Date(Date.UTC(2030, 5, 1, 9, 6)),
    });
    await cancelTrip(crewAfterDive.trip.id);

    // The crew checkpoint follows newest-wins too: clearing a boarding mark
    // retracts that checkpoint's sailed evidence.
    const crewCleared = await targetTrip("crew-cleared");
    await db
      .insert(tripAssignments)
      .values({ tripId: crewCleared.trip.id, personId: staff.person.id })
      .onConflictDoNothing();
    await db.insert(rollCallCrewEvents).values([
      {
        shopId: shop.id,
        tripId: crewCleared.trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        status: "boarded",
        checkpoint: "departure",
        occurredAt: new Date(Date.UTC(2030, 5, 1, 9, 7)),
      },
      {
        shopId: shop.id,
        tripId: crewCleared.trip.id,
        personId: staff.person.id,
        recordedByPersonId: staff.person.id,
        status: "cleared",
        checkpoint: "departure",
        occurredAt: new Date(Date.UTC(2030, 5, 1, 9, 8)),
      },
    ]);
    await cancelTrip(crewCleared.trip.id);

    expect((await countDeparturesByBoat(db, shop.id)).get(boat.id)).toBe(4);
    expect((await countDeparturesByTripLens(db, shop.id)).get(lensId)).toBe(4);
  });
});
