// @vitest-environment node
import { describe, expect, it } from "vitest";
import { createBooking } from "./bookings";
import { createTestDb } from "./client";
import { listNotificationDeliveryIssues, recordNotificationDelivery } from "./notifications";
import { getShopBySlug, upcomingTripsWithCounts } from "./queries";
import { seedDemo } from "./seed";

async function seededBooking() {
  const db = await createTestDb();
  await seedDemo(db);
  const shop = await getShopBySlug(db, "blue-mantis");
  if (!shop) throw new Error("demo shop missing");
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booking = await createBooking(db, {
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Nora Quinn",
    email: "nora@example.com",
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  return { db, shop, trip, booking };
}

describe("notification delivery status", () => {
  it("shows a failed booking email on the shop dashboard query", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "booking_confirmation",
      delivery: { status: "failed" },
    });

    await expect(listNotificationDeliveryIssues(db, shop.id)).resolves.toMatchObject([
      {
        delivery: { kind: "booking_confirmation", status: "failed" },
        person: { fullName: "Nora Quinn" },
        trip: { id: trip.id },
      },
    ]);
  });

  it("updates an issue to sent when the same booking notification later succeeds", async () => {
    const { db, shop, booking } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "waiver_request",
      delivery: { status: "not_configured" },
    });
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "waiver_request",
      delivery: { status: "sent", providerMessageId: "resend-message-id" },
    });

    await expect(listNotificationDeliveryIssues(db, shop.id)).resolves.toEqual([]);
  });

  it("refuses to create a status record for a booking outside the shop", async () => {
    const { db, booking } = await seededBooking();

    await expect(
      recordNotificationDelivery(db, {
        shopId: "00000000-0000-4000-8000-000000000099",
        bookingId: booking.bookingId,
        kind: "booking_confirmation",
        delivery: { status: "failed" },
      }),
    ).resolves.toBeNull();
  });
});
