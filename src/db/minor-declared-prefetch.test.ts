import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { now, waiverContextFor } from "../test/substrate-fixtures/db/waivers-test-fixtures";
import { peopleMinorDeclared } from "./minor-declared";
import { bookings, trips } from "./schema";
import { listTripsWaiverStatuses } from "./waivers-trip-status";

const context = waiverContextFor(fileScopedShopContext());

describe("guardian candidate facts carried by the roster", () => {
  it("preserves dates and the existing standing rules for cancelled, deleted and returned seats", async () => {
    const { db, shop, booking, person } = await context();
    await db.update(bookings).set({ minorDeclaredAt: now }).where(eq(bookings.id, booking.id));
    const compare = async (at = now) => {
      const input = { shopId: shop.id, personIds: [person.id], now: at };
      const rows = await listTripsWaiverStatuses(db, shop.id, [booking.tripId]);
      const row = rows.find((entry) => entry.person.id === person.id);
      if (!row) throw new Error("test needs its live roster seat");
      const seat = row.minorDeclaredSeats.find((entry) => entry.bookingId === booking.id);
      expect(seat?.minorDeclaredAt).toEqual(now);
      expect(seat?.trip.endsAt).toBeInstanceOf(Date);
      expect(seat?.trip.startsAt).toBeInstanceOf(Date);
      if (!seat) throw new Error("declared seat missing");
      const unrequested = {
        ...seat,
        bookingId: "unrequested-seat",
        personId: "unrequested-person",
        trip: {
          ...seat.trip,
          status: "scheduled",
          deletedAt: null,
          endsAt: new Date("2100-01-01T00:00:00Z"),
        },
      };
      expect(
        await peopleMinorDeclared(db, {
          ...input,
          seats: [...row.minorDeclaredSeats, unrequested],
        }),
      ).toEqual(await peopleMinorDeclared(db, input));
      expect(await peopleMinorDeclared(db, { ...input, seats: row.minorDeclaredSeats })).toEqual(
        await peopleMinorDeclared(db, input),
      );
      expect(
        await peopleMinorDeclared(db, {
          ...input,
          calledOffToo: true,
          seats: row.minorDeclaredSeats,
        }),
      ).toEqual(await peopleMinorDeclared(db, { ...input, calledOffToo: true }));
    };
    await compare();
    await db.update(trips).set({ status: "cancelled" }).where(eq(trips.id, booking.tripId));
    await compare();
    await db.update(trips).set({ deletedAt: now }).where(eq(trips.id, booking.tripId));
    await compare();
    await db
      .update(trips)
      .set({ deletedAt: null, status: "scheduled" })
      .where(eq(trips.id, booking.tripId));
    await compare(new Date("2099-01-01T00:00:00Z"));
  });
});
