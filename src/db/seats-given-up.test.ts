import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { createBookingParty } from "./bookings";
import { activityEvents, bookings, people, trips as tripsTable } from "./schema";
import { seatsGivenUpInWindow } from "./seats-given-up";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The seats the month lost** (loop 5, row 12): no-shows, and a diver's own
 * cancel inside the departure's stated window. A turned-away diver is neither,
 * and a departure that states no window has no late cancel.
 */
const ctx = fileScopedShopContext();

async function oneSeat(email: string) {
  const { db, shop } = ctx;
  const [trip] = (await upcomingTripsWithCounts(db, shop.id)).filter(
    (candidate) => !candidate.course && candidate.capacity - candidate.booked >= 1,
  );
  if (!trip) throw new Error("no bookable trip");
  const party = await createBookingParty(db, [
    { actor: "staff" as const, shopId: shop.id, tripId: trip.id, fullName: "Seat", email },
  ]);
  if (!party.ok) throw new Error(`booking failed: ${party.reason}`);
  const [row] = await db
    .select({ startsAt: tripsTable.startsAt })
    .from(tripsTable)
    .where(eq(tripsTable.id, trip.id));
  const startsAt = row?.startsAt ?? nowDate();
  return {
    tripId: trip.id,
    bookingId: party.bookings[0]?.bookingId ?? "",
    window: {
      startUtc: new Date(startsAt.getTime() - 86_400_000),
      endUtc: new Date(startsAt.getTime() + 86_400_000),
    },
    startsAt,
  };
}

async function cancelledAt(tripId: string, bookingId: string, at: Date) {
  const { db, shop } = ctx;
  const [staffer] = await db
    .select({ id: people.id })
    .from(people)
    .where(and(eq(people.shopId, shop.id), eq(people.fullName, "Dana Reyes")))
    .limit(1);
  await db.insert(activityEvents).values({
    shopId: shop.id,
    tripId,
    bookingId,
    actorPersonId: staffer?.id,
    code: "seat_self_cancelled",
    params: { actor: "Diver" },
    occurredAt: at,
  });
}

describe("seatsGivenUpInWindow", () => {
  it("counts a released seat as a no-show, and a turned-away diver as neither", async () => {
    const { db, shop } = ctx;
    const seat = await oneSeat("noshow@example.com");
    expect(await seatsGivenUpInWindow(db, shop.id, seat.window)).toEqual({
      noShows: 0,
      lateCancels: 0,
    });
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.bookingId));
    expect((await seatsGivenUpInWindow(db, shop.id, seat.window)).noShows).toBe(1);

    await db
      .update(bookings)
      .set({ turnedAwayAt: seat.startsAt, turnedAwayReason: "card" })
      .where(eq(bookings.id, seat.bookingId));
    expect((await seatsGivenUpInWindow(db, shop.id, seat.window)).noShows).toBe(0);
  });

  it("counts a diver's cancel only inside the departure's own window", async () => {
    const { db, shop } = ctx;
    const seat = await oneSeat("late@example.com");
    await db
      .update(tripsTable)
      .set({ cancellationWindowHours: 24 })
      .where(eq(tripsTable.id, seat.tripId));

    await cancelledAt(
      seat.tripId,
      seat.bookingId,
      new Date(seat.startsAt.getTime() - 48 * 3_600_000),
    );
    expect((await seatsGivenUpInWindow(db, shop.id, seat.window)).lateCancels).toBe(0);

    await cancelledAt(
      seat.tripId,
      seat.bookingId,
      new Date(seat.startsAt.getTime() - 3 * 3_600_000),
    );
    expect((await seatsGivenUpInWindow(db, shop.id, seat.window)).lateCancels).toBe(1);
  });

  it("has no late cancel on a departure that states no window", async () => {
    const { db, shop } = ctx;
    const seat = await oneSeat("nowindow@example.com");
    await db
      .update(tripsTable)
      .set({ cancellationWindowHours: null })
      .where(eq(tripsTable.id, seat.tripId));
    await cancelledAt(seat.tripId, seat.bookingId, new Date(seat.startsAt.getTime() - 3_600_000));
    expect((await seatsGivenUpInWindow(db, shop.id, seat.window)).lateCancels).toBe(0);
  });

  it("stays inside the shop", async () => {
    const { db } = ctx;
    const seat = await oneSeat("other@example.com");
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.bookingId));
    expect(
      await seatsGivenUpInWindow(db, "00000000-0000-0000-0000-000000000000", seat.window),
    ).toEqual({ noShows: 0, lateCancels: 0 });
  });
});
