// @vitest-environment node
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { issueBookingCapability, revokeBookingCapabilities } from "@/db/booking-capabilities";
import { createBooking } from "@/db/bookings";
import { bookings, people } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips-queries.test-support";
import { nowDate } from "@/lib/clock";
import { fileScopedShopContext } from "@/test/db";
import { getDiverPhotoForCapability } from "./diver-read";

const ctx = fileScopedShopContext();
const photoA = "https://media.example/private-person-photos/AAAAAAAAAAAAAAAAAAAAAA.jpg";
const photoB = "https://media.example/private-person-photos/BBBBBBBBBBBBBBBBBBBBBB.jpg";

describe("diver photo capability read", () => {
  it("accepts only the delivered link's current photo, and refuses held, removed and revoked access", async () => {
    const { db, shop } = ctx;
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("no trip");
    const booked = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Ari Diver",
      email: "ari-photo@example.com",
    });
    if (!booked.ok) throw new Error("booking failed");
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, booked.bookingId));
    if (!seat) throw new Error("missing seat");
    await db.update(people).set({ diverPhotoPath: photoA }).where(eq(people.id, seat.personId));
    const delivered = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
      delivered: true,
    });
    const undelivered = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
    });
    if (!delivered || !undelivered) throw new Error("missing links");
    const read = (token: string, assetId = "AAAAAAAAAAAAAAAAAAAAAA.jpg") =>
      getDiverPhotoForCapability(db, { token, assetId });
    expect(await read(delivered.token)).toMatchObject({ url: photoA });
    expect(await read(undelivered.token)).toBeNull();
    expect(await read(delivered.token, "BBBBBBBBBBBBBBBBBBBBBB.jpg")).toBeNull();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate() })
      .where(eq(bookings.id, booked.bookingId));
    expect(await read(delivered.token)).toBeNull();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null })
      .where(eq(bookings.id, booked.bookingId));
    await db.update(people).set({ diverPhotoPath: photoB }).where(eq(people.id, seat.personId));
    expect(await read(delivered.token)).toBeNull();
    expect(await read(delivered.token, "BBBBBBBBBBBBBBBBBBBBBB.jpg")).toMatchObject({
      url: photoB,
    });
    await db.update(people).set({ diverPhotoSuppressed: true }).where(eq(people.id, seat.personId));
    expect(await read(delivered.token, "BBBBBBBBBBBBBBBBBBBBBB.jpg")).toBeNull();
    await db
      .update(people)
      .set({ diverPhotoSuppressed: false })
      .where(eq(people.id, seat.personId));
    await db.update(people).set({ diverPhotoPath: null }).where(eq(people.id, seat.personId));
    expect(await read(delivered.token, "BBBBBBBBBBBBBBBBBBBBBB.jpg")).toBeNull();
    await db.update(people).set({ diverPhotoPath: photoA }).where(eq(people.id, seat.personId));
    await revokeBookingCapabilities(db, {
      shopId: shop.id,
      bookingId: booked.bookingId,
      purpose: "readiness",
    });
    expect(await read(delivered.token)).toBeNull();
  });
});
