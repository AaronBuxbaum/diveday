import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { departureLead } from "@/test/leads";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { bookings, leads, notificationSendQueue } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// One seeded database for the file and a rolled-back transaction per test
// (src/test/db.ts, `fileScopedShopContext`).
const ctx = fileScopedShopContext();

/** Fails the first send retryably, then would deliver anything it is handed. */
function flakyProvider() {
  const sent: string[] = [];
  let calls = 0;
  const provider: NotificationProvider = {
    async send(notification) {
      calls += 1;
      if (calls === 1) return { status: "failed", retryable: true, errorCode: "throttled" };
      sent.push(notification.kind);
      return { status: "sent", providerMessageId: `msg-${calls}` };
    },
  };
  return { provider, sent };
}

// Security review of #2656, MAJOR 1: an offer made off the last-minute list is
// stopped by that list's own unsubscribe, even one queued before it. The drain
// asks again before it retries (issue #2132).
describe("a list offer waiting in the retry queue", () => {
  it("is dropped once its last-minute-list lead was unsubscribed after it was queued", async () => {
    const { db, shop } = ctx;
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("demo trip missing");
    const booking = await createBooking(db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Nora Quinn",
      email: "nora@example.com",
    });
    if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
    const [seat] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId));
    if (!seat) throw new Error("booking missing");
    const [anytime] = await db
      .insert(leads)
      .values({ shopId: shop.id, scope: "anytime", askedBy: "diver", personId: seat.personId })
      .returning();
    if (!anytime) throw new Error("anytime insert failed");
    const [offer] = await db
      .insert(leads)
      .values(
        departureLead({
          shopId: shop.id,
          tripId: trip.id,
          personId: seat.personId,
          askedBy: "shop",
          parentLeadId: anytime.id,
        }),
      )
      .returning();
    if (!offer) throw new Error("offer insert failed");
    const { provider, sent } = flakyProvider();
    await expect(
      sendNotification(
        db,
        {
          locale: "en-US",
          diverName: "Nora Quinn",
          tripTitle: "Two-Tank Reef",
          startsAt: new Date("2026-08-01T12:00:00.000Z"),
          endsAt: new Date("2026-08-01T15:00:00.000Z"),
          timezone: "America/New_York",
          kind: "seat_offer_commercial",
          askedBy: "shop",
          leadId: offer.id,
          shopId: shop.id,
          to: "nora@example.com",
          shopName: shop.name,
          bookingUrl: "https://diveday.test/s/blue-mantis/trips/x",
          offeredAt: new Date("2026-07-19T00:00:00.000Z"),
          unsubscribeUrl: "https://diveday.test/unsubscribe/x",
        },
        provider,
      ),
    ).resolves.toMatchObject({ status: "failed", retryable: true });
    await db
      .update(leads)
      .set({ closedAt: new Date("2026-07-20T00:00:00.000Z"), closedAs: "unsubscribed" })
      .where(eq(leads.id, anytime.id));
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));

    await expect(drainNotificationRetries(db, { provider })).resolves.toMatchObject({
      sent: 0,
      failed: 1,
    });
    expect(sent).toEqual([]);
  });
});
