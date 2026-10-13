import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { bookings, people, shops, trips } from "./schema";
import { getBookingTripId, getWaiverSignerOnFile, getWaiverTripHeader } from "./waiver-signing";
import { getEmergencyContactForBearer } from "./waivers-completion";

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

    expect(await getBookingTripId(db, shop.id, row.bookingId)).toBe(row.tripId);
    expect(await getWaiverTripHeader(db, shop.id, row.bookingId)).toMatchObject({
      title: row.title,
    });
  });

  it("reads the name a release is signed under", async () => {
    const { db, shop } = await seededShopContext();
    const [person] = await db
      .select({ id: people.id, fullName: people.fullName })
      .from(people)
      .where(eq(people.shopId, shop.id))
      .limit(1);
    if (!person) throw new Error("seed has no person");

    expect(await getWaiverSignerOnFile(db, shop.id, person.id)).toMatchObject({
      fullName: person.fullName,
    });
  });

  it("answers nothing for an id that names no row, rather than throwing", async () => {
    const { db, shop } = await seededShopContext();
    expect(await getBookingTripId(db, shop.id, MISSING)).toBeNull();
    expect(await getWaiverTripHeader(db, shop.id, MISSING)).toBeNull();
    expect(await getWaiverSignerOnFile(db, shop.id, MISSING)).toBeUndefined();
    expect(await getEmergencyContactForBearer(db, shop.id, MISSING)).toBeNull();
  });

  it("answers nothing when the id is real but the shop is another one", async () => {
    const { db, shop } = await seededShopContext();
    const [row] = await db
      .select({ bookingId: bookings.id, personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.shopId, shop.id))
      .limit(1);
    if (!row) throw new Error("seed has no booking");
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-waiver-signing", timezone: "UTC" })
      .returning();
    if (!other) throw new Error("second shop insert failed");

    // The same ids under their own shop do resolve, so the nulls below are the shop filter.
    expect(await getBookingTripId(db, shop.id, row.bookingId)).not.toBeNull();
    expect(await getEmergencyContactForBearer(db, shop.id, row.bookingId)).not.toBeNull();
    expect(await getWaiverSignerOnFile(db, shop.id, row.personId)).toBeDefined();

    expect(await getBookingTripId(db, other.id, row.bookingId)).toBeNull();
    expect(await getWaiverTripHeader(db, other.id, row.bookingId)).toBeNull();
    expect(await getWaiverSignerOnFile(db, other.id, row.personId)).toBeUndefined();
    expect(await getEmergencyContactForBearer(db, other.id, row.bookingId)).toBeNull();
  });
});
