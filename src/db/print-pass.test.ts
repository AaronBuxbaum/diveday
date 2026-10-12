import { and, eq, ne } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { getPassBooking } from "./print-pass";
import { bookings, people, shops } from "./schema";

const ctx = fileScopedShopContext();

async function aSeat() {
  const { db, shop } = ctx;
  const [seat] = await db
    .select({ bookingId: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), ne(bookings.status, "cancelled")))
    .limit(1);
  if (!seat) throw new Error("fixture needs a seat");
  return seat;
}

/**
 * The paper pass names a diver: the name it prints is read from a person
 * record of the caller's shop, the same tenancy the reschedule reader keeps,
 * so a booking that somehow points at another shop's person prints nothing.
 */
describe("getPassBooking", () => {
  it("reads the seat's own diver and departure", async () => {
    const { db, shop } = ctx;
    const seat = await aSeat();
    const pass = await getPassBooking(db, shop.id, seat.bookingId);
    const [person] = await db.select().from(people).where(eq(people.id, seat.personId));
    expect(pass?.bookingId).toBe(seat.bookingId);
    expect(pass?.diverName).toBe(person?.fullName);
  });

  it("prints nothing when the booking's person belongs to another shop", async () => {
    const { db, shop } = ctx;
    const seat = await aSeat();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-print-pass", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    await db.update(people).set({ shopId: other.id }).where(eq(people.id, seat.personId));
    expect(await getPassBooking(db, shop.id, seat.bookingId)).toBeNull();
  });
});
