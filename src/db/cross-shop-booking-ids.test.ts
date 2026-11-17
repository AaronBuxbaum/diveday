// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { insertShop } from "../test/substrate-fixtures/db/gear-counter-rentals-test-fixtures";
import {
  issueBookingCapability,
  revokeBookingCapabilities,
  revokeBookingLinksSentToPerson,
} from "./booking-capabilities";
import { createBooking } from "./bookings";
import {
  correctFlySafeForBooking,
  correctFlySafeForPerson,
  correctFlySafeForTripChange,
} from "./fly-safe-correction";
import { bookingCapabilities, bookings } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * A booking, trip or person id from one shop, handed to a mutator that is
 * running as another, changes nothing (issue #4607). The ids reach these
 * functions from forms and links, so the shop in each `where` is the only fence.
 * The `setShop*` setters take only a shop id and have no second id to cross.
 */
const ctx = fileScopedShopContext();

async function seatInOneShopCallerInAnother() {
  const { db, shop } = ctx;
  const trip = (await upcomingTripsWithCounts(db, shop.id))[0];
  if (!trip) throw new Error("seeded trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  const [seat] = await db.select().from(bookings).where(eq(bookings.id, booked.bookingId));
  if (!seat) throw new Error("seat missing");
  const outsider = await insertShop(db, "outsider-shop");
  return { db, shop, trip, seat, outsider };
}

describe("booking ids from another shop are refused (issue #4607)", () => {
  it("does not revoke another shop's links", async () => {
    const { db, seat, outsider } = await seatInOneShopCallerInAnother();
    const issued = await issueBookingCapability(db, {
      shopId: seat.shopId,
      bookingId: seat.id,
      purpose: "readiness",
      delivered: true,
    });
    if (!issued) throw new Error("setup capability failed");

    await revokeBookingCapabilities(db, { shopId: outsider.id, bookingId: seat.id });
    await revokeBookingLinksSentToPerson(db, { shopId: outsider.id, personId: seat.personId });

    const rows = await db
      .select({ revokedAt: bookingCapabilities.revokedAt })
      .from(bookingCapabilities)
      .where(eq(bookingCapabilities.bookingId, seat.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]?.revokedAt).toBeNull();
  });

  it("does not issue a link for another shop's booking", async () => {
    const { db, seat, outsider } = await seatInOneShopCallerInAnother();
    expect(
      await issueBookingCapability(db, {
        shopId: outsider.id,
        bookingId: seat.id,
        purpose: "readiness",
      }),
    ).toBeNull();
    expect(
      await db.select().from(bookingCapabilities).where(eq(bookingCapabilities.bookingId, seat.id)),
    ).toHaveLength(0);
  });

  it("does not correct another shop's fly-safe reminders", async () => {
    const { db, seat, trip, outsider } = await seatInOneShopCallerInAnother();
    const none = { told: 0, failed: 0, unreached: [] };
    expect(await correctFlySafeForBooking(db, { shopId: outsider.id, bookingId: seat.id })).toEqual(
      none,
    );
    expect(await correctFlySafeForTripChange(db, { shopId: outsider.id, tripId: trip.id })).toEqual(
      none,
    );
    expect(
      await correctFlySafeForPerson(db, { shopId: outsider.id, personId: seat.personId }),
    ).toEqual(none);
  });
});
