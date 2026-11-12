import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { addPartySeat, cancelBooking, createBooking } from "../../db/bookings";
import { setBookingPayment } from "../../db/payments";
import { bookings } from "../../db/schema/index";
import { setShopStripeAccountStatus, upsertShopStripeAccount } from "../../db/stripe-accounts";
import { upcomingTripsWithCounts } from "../../db/trips";
import { nowDate } from "../../lib/clock";
import { fileScopedShopContext } from "../../test/db";
import { getReadyPageData } from "./store";

// The same seeded, per-test rollback isolation as the readiness loader suite.
const ctx = fileScopedShopContext();

/** A fresh unpaid booking on the seeded "open" reef trip. */
async function unpaidBooking() {
  const { db, shop } = ctx;
  const trips = await upcomingTripsWithCounts(db, shop.id);
  const open = trips.find((t) => t.title === "Two-Tank Reef — Christ of the Abyss");
  if (!open) throw new Error("expected seeded open trip missing");
  const booked = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: open.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
    phone: "+1-305-555-0199",
  });
  if (!booked.ok) throw new Error("setup booking failed");
  return { db, shop, open, bookingId: booked.bookingId };
}

describe("getReadyPageData", () => {
  /** UX review 2026-10-11, item 13: the page draws "Add a seat" only where it can work. */
  it("offers a seat to add on a booking that may lead one, never on a party member's seat", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
    const added = await addPartySeat(db, {
      shopId: shop.id,
      leadBookingId: bookingId,
      seatName: "Milo",
    });
    if (!added.ok) throw new Error("add failed");
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
    expect((await getReadyPageData(db, added.bookingId))?.canAddSeat).toBe(false);
  });

  /**
   * Security review of layer 8, D3: the link is shared by design, so a lead
   * who has not paid on a page that takes payment cannot fill the boat with
   * unpaid seats. Paying (or a page that takes no payment) opens the door.
   */
  it("offers no seat to add until a lead the page could charge has paid", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await upsertShopStripeAccount(db, shop.id, "acct_ready_add_seat");
    await setShopStripeAccountStatus(db, "acct_ready_add_seat", {
      chargesEnabled: true,
      payoutsEnabled: true,
      detailsSubmitted: true,
    });
    const owing = await getReadyPageData(db, bookingId);
    expect(owing?.canPay).toBe(true);
    expect(owing?.canAddSeat).toBe(false);
    // A page that can take the card is not money owed at the shop.
    expect(owing?.owesAtShop).toBe(false);

    await setBookingPayment(db, {
      shopId: shop.id,
      bookingId,
      status: "paid",
      currency: "usd",
      amountCents: 12_000,
      provider: "stripe",
      providerRef: "pi_ready_add_seat",
    });
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(true);
  });

  it("offers no seat to add on a held seat or a canceled one", async () => {
    const { db, shop, bookingId } = await unpaidBooking();
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: nowDate(), identityBookedAs: "Nora Q" })
      .where(eq(bookings.id, bookingId));
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(false);
    await db
      .update(bookings)
      .set({ identityUnconfirmedAt: null, identityBookedAs: null })
      .where(eq(bookings.id, bookingId));
    await cancelBooking(db, shop.id, bookingId);
    expect((await getReadyPageData(db, bookingId))?.canAddSeat).toBe(false);
  });
});
