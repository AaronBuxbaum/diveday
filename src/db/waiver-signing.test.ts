import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, trips } from "./schema";
import { getBookingTripId, getWaiverSignerOnFile, getWaiverTripHeader } from "./waiver-signing";

const MISSING = "00000000-0000-0000-0000-000000000000";

describe("the waiver signing page's reads (in-memory PGlite)", () => {
  it("reads a booking's departure and the trip it names", async () => {
    const { db, shop } = await seededShopContext();
    const [row] = await db
      .select({ bookingId: bookings.id, tripId: bookings.tripId, title: trips.title })
      .from(bookings)
      .innerJoin(trips, eq(trips.id, bookings.tripId))
      .where(eq(trips.shopId, shop.id))
      .limit(1);
    if (!row) throw new Error("seed has no booking");

    expect(await getBookingTripId(db, row.bookingId)).toBe(row.tripId);
    expect(await getWaiverTripHeader(db, row.bookingId)).toMatchObject({ title: row.title });
  });

  it("reads the name a release is signed under", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!person) throw new Error("seed has no person");

    expect(await getWaiverSignerOnFile(db, person.id)).toMatchObject({
      fullName: person.fullName,
    });
  });

  it("answers nothing for an id that names no row, rather than throwing", async () => {
    const { db } = await seededShopContext();
    expect(await getBookingTripId(db, MISSING)).toBeNull();
    expect(await getWaiverTripHeader(db, MISSING)).toBeNull();
    expect(await getWaiverSignerOnFile(db, MISSING)).toBeUndefined();
  });
});
