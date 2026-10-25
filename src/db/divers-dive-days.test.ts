import { and, eq, isNull } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getDiverProfile } from "./divers";
import { bookings, trips } from "./schema";

/**
 * **Which of a diver's seats are dive days**, asked of each seat by the
 * profile read with the one rule (`numberedDiveDay()`), so the record's
 * standing line counts what the milestone and the recap count (issue 2809).
 */
const ctx = fileScopedShopContext();

describe("getDiverProfile's dive-day and day-out flags", () => {
  // Issue 2809: the standing line counts dive days by the one rule, asked here.
  it("says which seats are numbered dive days: not a no-show, not a ride-along", async () => {
    const { db, shop } = ctx;
    const [seat] = await db
      .select({ id: bookings.id, personId: bookings.personId })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(
        and(
          eq(bookings.shopId, shop.id),
          eq(bookings.status, "booked"),
          eq(bookings.participantType, "diver"),
          isNull(bookings.identityUnconfirmedAt),
          eq(trips.status, "scheduled"),
          isNull(trips.deletedAt),
        ),
      )
      .limit(1);
    if (!seat) throw new Error("no seeded diver seat");
    const flags = async () => {
      const entry = (await getDiverProfile(db, shop.id, seat.personId))?.bookings.find(
        (row) => row.booking.id === seat.id,
      );
      return { numbered: entry?.numberedDiveDay, out: entry?.outWithShop };
    };
    expect(await flags()).toEqual({ numbered: true, out: true });
    await db.update(bookings).set({ status: "no_show" }).where(eq(bookings.id, seat.id));
    expect(await flags()).toEqual({ numbered: false, out: false });
    await db
      .update(bookings)
      .set({ status: "booked", participantType: "rider" })
      .where(eq(bookings.id, seat.id));
    // A ride-along is no dive day of theirs, and still a day out (review 2).
    expect(await flags()).toEqual({ numbered: false, out: true });
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: new Date("2026-10-01T00:00:00Z") })
      .where(eq(bookings.id, seat.id));
    // A seat matched on a guess may be somebody else's.
    expect(await flags()).toEqual({ numbered: false, out: false });
    await db
      .update(bookings)
      .set({ participantType: "diver", identityUnconfirmedAt: null })
      .where(eq(bookings.id, seat.id));
  });
});
