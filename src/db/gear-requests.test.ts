// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createBooking } from "./bookings";
import { createTestDb } from "./client";
import {
  getRentalGearProfile,
  getRentalGearRequest,
  listTripRentalGearRequests,
  saveRentalGearRequest,
} from "./gear-requests";
import { getBookingForTrip, getShopBySlug, upcomingTripsWithCounts } from "./queries";
import { seedDemo } from "./seed";

describe("rental gear requests (in-memory PGlite)", () => {
  it("keeps an editable booking-level request separate from inventory allocation", async () => {
    const db = await createTestDb();
    await seedDemo(db);
    const shop = await getShopBySlug(db, "blue-mantis");
    if (!shop) throw new Error("demo shop missing");
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const booked = await createBooking(db, {
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!booked.ok) throw new Error(`booking failed: ${booked.reason}`);

    const saved = await saveRentalGearRequest(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      bcd: true,
      regulator: true,
      wetsuit: true,
      maskFins: false,
      weights: true,
      tank: true,
      diveComputer: true,
      bcdSize: "L",
      wetsuitSize: "XL",
      bootSize: "10",
      finSize: "L",
      weightPreference: "18 lb with a 3 mm suit",
      note: "Bringing my own mask.",
    });
    expect(saved).toMatchObject({ bcdSize: "L", maskFins: false, diveComputer: true });

    const revised = await saveRentalGearRequest(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      bcd: true,
      regulator: true,
      wetsuit: false,
      maskFins: false,
      weights: true,
      tank: true,
      diveComputer: false,
      bcdSize: "L",
    });
    expect(revised).toMatchObject({ wetsuit: false, diveComputer: false, bcdSize: "L" });

    const direct = await getRentalGearRequest(db, shop.id, booked.bookingId);
    expect(direct?.weightPreference).toBeNull();
    const roster = await listTripRentalGearRequests(db, shop.id, trip.id);
    const row = roster.find((entry) => entry.booking.id === booked.bookingId);
    expect(row?.request?.bcdSize).toBe("L");
    expect(row?.profile).toMatchObject({ bcdSize: "L", weightPreference: null });
    const bookingRow = await getBookingForTrip(db, trip.id, booked.bookingId);
    if (!bookingRow) throw new Error("expected booking row");
    expect(await getRentalGearProfile(db, shop.id, bookingRow.person.id)).toMatchObject({
      bcdSize: "L",
    });
  });
});
