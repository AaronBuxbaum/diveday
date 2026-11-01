import { eq } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { DAY_MS, HOUR_MS, nowDate } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { describePostgres, postgresTestDb } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { pruneExpiredRecords } from "./retention";
import { notificationSendQueue } from "./schema";
import { createTrip } from "./trips";

afterEach(() => vi.unstubAllEnvs());

/**
 * Issue #3312, the booking-bound half (the person-scoped half is in
 * person-waiver-erasure.postgres.test.ts). A queued retry whose `booking_id`
 * no longer matches the booking its sealed payload names is finished unsent
 * and scrubbed, so the 90-day prune takes it. A correctly bound row in the
 * same pass is not touched by that: it keeps its payload and handles and is
 * retried as usual.
 */
describePostgres("an unbound booking retry", () => {
  it("is scrubbed and pruned, while a bound row in the same pass is retried untouched", async () => {
    vi.stubEnv(
      "SECRET_ENCRYPTION_KEY",
      Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    );
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const startsAt = new Date("2035-03-12T12:00:00Z");
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Unbound retry trip",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip missing");

    const seat = async (fullName: string, email: string) => {
      const booking = await createBooking(pg.db, {
        actor: "staff",
        shopId: shop.id,
        tripId: trip.id,
        fullName,
        email,
      });
      if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
      const notification: Notification = {
        kind: "booking_confirmation",
        bookingId: booking.bookingId,
        shopId: shop.id,
        to: email,
        locale: "en-US",
        diverName: fullName,
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: "UTC",
      };
      await sendNotification(pg.db, notification, {
        async send() {
          return { status: "failed", retryable: true, errorCode: "temporary_failure" };
        },
      });
      const [row] = await pg.db
        .select()
        .from(notificationSendQueue)
        .where(eq(notificationSendQueue.bookingId, booking.bookingId));
      if (!row?.payloadSealed || !row.recipientPersonId || !row.recipientTripId) {
        throw new Error("the retry was not queued with its binding");
      }
      return { bookingId: booking.bookingId, row };
    };
    const unbound = await seat("Unbound Diver", "unbound@example.org");
    const bound = await seat("Bound Diver", "bound@example.org");

    // The out-of-band edit no supported writer makes: point the row at a
    // booking its sealed payload does not name.
    await pg.db
      .update(notificationSendQueue)
      .set({ bookingId: bound.bookingId })
      .where(eq(notificationSendQueue.id, unbound.row.id));

    const send = vi.fn<NotificationProvider["send"]>(async () => ({
      status: "failed",
      retryable: true,
      errorCode: "temporary_failure",
    }));
    await drainNotificationRetries(pg.db, {
      now: new Date(nowDate().getTime() + 2 * DAY_MS),
      provider: { send },
    });

    // Only the bound row reached the provider, and only to its own address.
    expect(send).toHaveBeenCalledOnce();
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: "bound@example.org" });

    const [finished] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.id, unbound.row.id));
    expect(finished).toMatchObject({
      status: "failed",
      errorCode: "retry_subject_unbound",
      payloadSealed: null,
      recipientEmail: null,
      subjectEmail: null,
      subjectPhone: null,
      bookingId: null,
      recipientPersonId: null,
      recipientTripId: null,
      lockedUntil: null,
    });

    const [retried] = await pg.db
      .select()
      .from(notificationSendQueue)
      .where(eq(notificationSendQueue.id, bound.row.id));
    expect(retried).toMatchObject({
      status: "queued",
      payloadSealed: bound.row.payloadSealed,
      recipientEmail: bound.row.recipientEmail,
      bookingId: bound.bookingId,
      recipientPersonId: bound.row.recipientPersonId,
      recipientTripId: bound.row.recipientTripId,
    });

    const finishedAt = finished?.updatedAt ?? nowDate();
    await pruneExpiredRecords(pg.db, { now: new Date(finishedAt.getTime() + 91 * DAY_MS) });
    const left = await pg.db.select({ id: notificationSendQueue.id }).from(notificationSendQueue);
    expect(left).toEqual([{ id: bound.row.id }]);
  });
});
