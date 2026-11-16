import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { bookingCheckouts, notificationSendQueue } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

async function seededBooking() {
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
  return { db, shop, trip, booking };
}

const SCHEDULE = {
  locale: "en-US" as const,
  diverName: "Nora Quinn",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-08-01T12:00:00.000Z"),
  endsAt: new Date("2026-08-01T15:00:00.000Z"),
  timezone: "America/New_York",
};

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

describe("a checkout reminder waiting in the queue", () => {
  async function queuedRecovery(status: "pending" | "completed") {
    const context = await seededBooking();
    const { db, shop, trip } = context;
    const [checkout] = await db
      .insert(bookingCheckouts)
      .values({
        shopId: shop.id,
        tripId: trip.id,
        status,
        stripeAccountId: "acct_test",
        stripeSessionId: "cs_queued",
        checkoutUrl: "https://checkout.stripe.com/c/pay/cs_queued",
        customerEmail: "nora@example.com",
        currency: "usd",
        amountPerDiverCents: 18_000,
        totalCents: 18_000,
      })
      .returning({ id: bookingCheckouts.id });
    if (!checkout) throw new Error("checkout insert failed");
    const { provider, sent } = flakyProvider();
    await expect(
      sendNotification(
        db,
        {
          ...SCHEDULE,
          kind: "checkout_recovery",
          checkoutId: checkout.id,
          shopId: shop.id,
          to: "nora@example.com",
          shopName: shop.name,
          checkoutUrl: "https://checkout.stripe.com/c/pay/cs_queued",
          unsubscribeUrl: "https://diveday.test/unsubscribe/x",
        },
        provider,
      ),
    ).resolves.toMatchObject({ status: "failed", retryQueued: true });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));
    return { db, shop, provider, sent };
  }

  it("goes out while the checkout is still open", async () => {
    const { db, provider, sent } = await queuedRecovery("pending");
    await drainNotificationRetries(db, { provider });
    expect(sent).toEqual(["checkout_recovery"]);
  });

  it("is dropped once the diver paid in the meantime", async () => {
    const { db, shop, provider, sent } = await queuedRecovery("completed");
    await expect(drainNotificationRetries(db, { provider })).resolves.toMatchObject({
      sent: 0,
      failed: 1,
    });
    expect(sent).toEqual([]);
    await expect(
      db.select().from(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([{ status: "failed", errorCode: "checkout_closed" }]);
  });
});
