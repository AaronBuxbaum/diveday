import { describe, expect, it } from "vitest";
import { fileScopedShopContext } from "@/test/db";
import { issueBookingCapability, verifyBookingCapability } from "./booking-capabilities";
import { createBooking } from "./bookings";
import { createDiver, editDiver } from "./divers";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **A corrected address takes the old links with it** (#3902). A delivered
 * booking link went to the email or phone on file; when staff change that
 * contact (a typo fixed), whoever holds the old address must not keep a live
 * link. The next send mints a fresh one to the new address. A link the
 * browser was handed (undelivered) is not about the address and stays.
 */
const ctx = fileScopedShopContext();

async function seatedDiver(suffix: string) {
  const { db, shop } = ctx;
  const diver = await createDiver(db, {
    shopId: shop.id,
    fullName: `Contact Change ${suffix}`,
    email: `contact-change-${suffix}@example.com`,
    phone: "+1 305 555 0170",
  });
  if (!diver) throw new Error("diver insert failed");
  const trip = (await upcomingTripsWithCounts(db, shop.id)).find(
    (candidate) => !candidate.course && candidate.capacity > candidate.booked,
  );
  if (!trip) throw new Error("open trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    personId: diver.id,
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const delivered = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
    delivered: true,
  });
  const handed = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.bookingId,
    purpose: "readiness",
  });
  if (!delivered || !handed) throw new Error("links missing");
  return { db, shop, diver, delivered: delivered.token, handed: handed.token };
}

const live = (token: string) =>
  verifyBookingCapability(ctx.db, { token, purpose: "readiness" }).then(Boolean);

describe("changing a diver's contact revokes their delivered links (#3902)", () => {
  it("revokes on an email change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("email");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: "contact-change-fixed@example.com",
      phone: "+1 305 555 0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("revokes on a phone change", async () => {
    const { db, shop, diver, delivered, handed } = await seatedDiver("phone");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: diver.fullName,
      email: `contact-change-phone@example.com`,
      phone: "+1 305 555 0171",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(false);
    expect(await live(handed)).toBe(true);
  });

  it("keeps the links when the save leaves both unchanged, however they were typed", async () => {
    const { db, shop, diver, delivered } = await seatedDiver("same");
    const result = await editDiver(db, {
      shopId: shop.id,
      personId: diver.id,
      fullName: "Renamed Only",
      email: "  Contact-Change-Same@Example.com ",
      phone: "305.555.0170",
    });
    expect(result.ok).toBe(true);
    expect(await live(delivered)).toBe(true);
  });
});
