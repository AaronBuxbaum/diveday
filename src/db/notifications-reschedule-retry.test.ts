import { eq, sql } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { meetingPointForMessage, meetingPointOfRows } from "@/lib/meeting-point";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { notificationSendQueue, trips } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

const ctx = fileScopedShopContext();

afterEach(() => vi.unstubAllEnvs());

describe("queued reschedule revisions", () => {
  it("does not deliver an obsolete reschedule after the departure moves twice", async () => {
    const { db, shop } = ctx;
    vi.stubEnv(
      "SECRET_ENCRYPTION_KEY",
      Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    );
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
    const notification: Notification = {
      kind: "trip_rescheduled",
      bookingId: booking.bookingId,
      shopId: shop.id,
      to: "nora@example.com",
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: shop.name,
      tripTitle: trip.title,
      previousStartsAt: trip.startsAt,
      startsAt: new Date(trip.startsAt.getTime() + 60 * 60 * 1000),
      endsAt: new Date(trip.endsAt.getTime() + 60 * 60 * 1000),
      timezone: shop.timezone,
      revision: trip.revision,
      meetingPointSnapshot: meetingPointForMessage(meetingPointOfRows(shop, trip)),
    };
    const initiallyFailed: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    };
    await sendNotification(db, notification, initiallyFailed);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));

    for (const offsetDays of [1, 2]) {
      await db
        .update(trips)
        .set({
          startsAt: new Date(notification.startsAt.getTime() + offsetDays * 24 * 60 * 60 * 1000),
          endsAt: new Date(notification.endsAt.getTime() + offsetDays * 24 * 60 * 60 * 1000),
          revision: sql`${trips.revision} + 1`,
        })
        .where(eq(trips.id, trip.id));
    }
    const send = vi.fn(async () => ({
      status: "sent" as const,
      providerMessageId: "must-not-send",
    }));

    await expect(drainNotificationRetries(db, { provider: { send } })).resolves.toMatchObject({
      scanned: 1,
      failed: 1,
    });

    expect(send).not.toHaveBeenCalled();
    await expect(
      db.select().from(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([
      { status: "failed", errorCode: "stale_reschedule", payloadSealed: null },
    ]);
  });
});
