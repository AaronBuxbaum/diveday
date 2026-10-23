import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { departureInterest } from "@/test/interests";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { bookings, interests, notificationSendQueue, shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

// Review 2026-10-23, item 10: a send a Features switch governs is asked again
// when the drain retries it, as the opt-out is (issue #2132). A staffer's own
// offer and a reminder that still lists something to finish always go.

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

async function seat() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const booking = await createBooking(db, {
    actor: "staff",
    shopId: shop.id,
    tripId: trip.id,
    fullName: "Rita Retry",
    email: "rita-retry@example.com",
  });
  if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
  const [row] = await db
    .select({ personId: bookings.personId })
    .from(bookings)
    .where(eq(bookings.id, booking.bookingId));
  if (!row) throw new Error("booking missing");
  return { db, shop, trip, bookingId: booking.bookingId, personId: row.personId };
}

/** Queue `notification` behind one retryable failure, switch `column` off, and drain. */
async function queuedThenSwitchedOff(
  notification: Notification,
  column: "waitlistEnabled" | "pastDiverInvitesEnabled" | "weekOutReminderEnabled",
) {
  const { db, shop } = ctx;
  const { provider, sent } = flakyProvider();
  await expect(sendNotification(db, notification, provider)).resolves.toMatchObject({
    status: "failed",
    retryable: true,
  });
  await db
    .update(shops)
    .set({ [column]: false })
    .where(eq(shops.id, shop.id));
  await db
    .update(notificationSendQueue)
    .set({ nextAttemptAt: new Date(0) })
    .where(eq(notificationSendQueue.shopId, shop.id));
  const summary = await drainNotificationRetries(db, { provider });
  const [queued] = await db
    .select({ errorCode: notificationSendQueue.errorCode })
    .from(notificationSendQueue)
    .where(eq(notificationSendQueue.shopId, shop.id));
  return { summary, sent, errorCode: queued?.errorCode ?? null };
}

const offerFields = {
  locale: "en-US" as const,
  diverName: "Rita Retry",
  tripTitle: "Two-Tank Reef",
  startsAt: new Date("2026-12-01T12:00:00.000Z"),
  endsAt: new Date("2026-12-01T15:00:00.000Z"),
  timezone: "America/New_York",
  to: "rita-retry@example.com",
  bookingUrl: "https://diveday.test/s/blue-mantis/trips/x",
  offeredAt: new Date("2026-11-19T00:00:00.000Z"),
};

async function waitingRow() {
  const { db, shop, trip, personId } = await seat();
  const [row] = await db
    .insert(interests)
    .values(departureInterest({ shopId: shop.id, tripId: trip.id, personId }))
    .returning();
  if (!row) throw new Error("interest insert failed");
  return { shop, interestId: row.id };
}

describe("a queued send whose switch went off", () => {
  it("drops the wait list's own offer", async () => {
    const { shop, interestId } = await waitingRow();
    const out = await queuedThenSwitchedOff(
      {
        ...offerFields,
        kind: "seat_offer",
        answers: "wait_list",
        interestId,
        shopId: shop.id,
        shopName: shop.name,
        governedBy: "waitlist",
      },
      "waitlistEnabled",
    );
    expect(out.sent).toEqual([]);
    expect(out.summary).toMatchObject({ sent: 0, failed: 1 });
    expect(out.errorCode).toBe("switched_off");
  });

  it("drops a past-diver suggestion's invite", async () => {
    const { shop, interestId } = await waitingRow();
    const out = await queuedThenSwitchedOff(
      {
        ...offerFields,
        kind: "seat_offer_commercial",
        askedBy: "shop",
        unsubscribeUrl: "https://diveday.test/unsubscribe/x",
        interestId,
        shopId: shop.id,
        shopName: shop.name,
        governedBy: "pastDiverInvites",
      },
      "pastDiverInvitesEnabled",
    );
    expect(out.sent).toEqual([]);
    expect(out.errorCode).toBe("switched_off");
  });

  it("still sends a staffer's own offer", async () => {
    const { shop, interestId } = await waitingRow();
    const out = await queuedThenSwitchedOff(
      {
        ...offerFields,
        kind: "seat_offer",
        answers: "wait_list",
        interestId,
        shopId: shop.id,
        shopName: shop.name,
      },
      "waitlistEnabled",
    );
    expect(out.sent).toEqual(["seat_offer"]);
  });

  const reminder = (bookingId: string, shopId: string, shopName: string, open: number) =>
    ({
      kind: "trip_reminder_7d",
      bookingId,
      shopId,
      shopName,
      to: "rita-retry@example.com",
      locale: "en-US",
      tripTitle: "Two-Tank Reef",
      startsAt: new Date("2026-12-01T12:00:00.000Z"),
      timezone: "America/New_York",
      open,
    }) as const;

  it("drops the week-out reminder's plain hello", async () => {
    const { shop, bookingId } = await seat();
    const out = await queuedThenSwitchedOff(
      reminder(bookingId, shop.id, shop.name, 0),
      "weekOutReminderEnabled",
    );
    expect(out.sent).toEqual([]);
    expect(out.errorCode).toBe("switched_off");
  });

  it("still sends a week-out reminder that lists something to finish", async () => {
    const { shop, bookingId } = await seat();
    const out = await queuedThenSwitchedOff(
      reminder(bookingId, shop.id, shop.name, 2),
      "weekOutReminderEnabled",
    );
    expect(out.sent).toEqual(["trip_reminder_7d"]);
  });
});
