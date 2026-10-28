import { and, eq, sql } from "drizzle-orm";
import { afterEach, expect, it, vi } from "vitest";
import { HOUR_MS } from "@/lib/clock";
import type { Notification } from "@/lib/notifications";
import { describePostgres, holdRowLock, postgresTestDb, waitForLockWaiters } from "@/test/postgres";
import { raceShop } from "@/test/postgres-shop";
import { createBooking } from "./bookings";
import { repointHeldBooking } from "./identity-repoint";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { bookings, notificationSendQueue, people } from "./schema";
import { createTrip } from "./trips";

afterEach(() => vi.unstubAllEnvs());

describePostgres("claimed retry cleanup after a booking repoint", () => {
  it("clears sealed payload and subject handles when repoint wins before dispatch", async () => {
    vi.stubEnv(
      "SECRET_ENCRYPTION_KEY",
      Buffer.from("0123456789abcdef0123456789abcdef").toString("base64"),
    );
    const pg = await postgresTestDb();
    const shop = await raceShop(pg.db);
    const startsAt = new Date("2035-03-12T12:00:00Z");
    const trip = await createTrip(pg.db, {
      shopId: shop.id,
      title: "Retry repoint trip",
      startsAt,
      endsAt: new Date(startsAt.getTime() + 4 * HOUR_MS),
      capacity: 6,
      plannedDives: 2,
    });
    if (!trip) throw new Error("trip missing");
    const booking = await createBooking(pg.db, {
      actor: "staff",
      shopId: shop.id,
      tripId: trip.id,
      fullName: "Same Name Diver",
      email: "original@example.org",
    });
    if (!booking.ok) throw new Error(`booking failed: ${booking.reason}`);
    const [actor] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Staff actor" })
      .returning({ id: people.id });
    const [replacement] = await pg.db
      .insert(people)
      .values({ shopId: shop.id, fullName: "Same Name Diver", email: "replacement@example.org" })
      .returning();
    if (!actor || !replacement) throw new Error("repoint fixture people missing");
    await pg.db
      .update(bookings)
      .set({
        identityUnconfirmedAt: new Date("2035-03-01T00:00:00Z"),
        identityBookedAs: "Same Name Diver",
        identityMatchedBy: "picked_name",
      })
      .where(eq(bookings.id, booking.bookingId));

    const notification: Notification = {
      kind: "trip_rescheduled",
      bookingId: booking.bookingId,
      shopId: shop.id,
      to: "original@example.org",
      locale: "en-US",
      diverName: "Same Name Diver",
      shopName: shop.name,
      tripTitle: trip.title,
      previousStartsAt: startsAt,
      startsAt: new Date(startsAt.getTime() + HOUR_MS),
      endsAt: new Date(startsAt.getTime() + 5 * HOUR_MS),
      timezone: "UTC",
      revision: trip.revision,
    };
    await sendNotification(pg.db, notification, {
      async send() {
        return { status: "failed", retryable: true, errorCode: "temporary_failure" };
      },
    });
    await pg.db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.bookingId, booking.bookingId));

    const bookingGate = await holdRowLock(
      pg,
      sql`select id from bookings where id = ${booking.bookingId} for update`,
    );
    const repoint = repointHeldBooking(pg.connect(), {
      shopId: shop.id,
      bookingId: booking.bookingId,
      actorPersonId: actor.id,
      toPersonId: replacement.id,
    });
    let drain: ReturnType<typeof drainNotificationRetries> | undefined;
    try {
      await waitForLockWaiters(pg.db, 1);
      drain = drainNotificationRetries(pg.connect(), {
        provider: {
          async send() {
            throw new Error("stale claimed retry reached provider");
          },
        },
      });
      await waitForLockWaiters(pg.db, 2);
    } finally {
      await bookingGate.release();
    }
    await expect(repoint).resolves.toMatchObject({ ok: true });
    await expect(drain).resolves.toMatchObject({ sent: 0, failed: 1 });
    const [row] = await pg.db
      .select({
        status: notificationSendQueue.status,
        errorCode: notificationSendQueue.errorCode,
        payloadSealed: notificationSendQueue.payloadSealed,
        recipientEmail: notificationSendQueue.recipientEmail,
        subjectEmail: notificationSendQueue.subjectEmail,
        subjectPhone: notificationSendQueue.subjectPhone,
        bookingId: notificationSendQueue.bookingId,
        recipientPersonId: notificationSendQueue.recipientPersonId,
        recipientTripId: notificationSendQueue.recipientTripId,
      })
      .from(notificationSendQueue)
      .where(
        and(eq(notificationSendQueue.shopId, shop.id), eq(notificationSendQueue.status, "failed")),
      )
      .limit(1);
    expect({
      status: row?.status,
      errorCode: row?.errorCode,
      hasSealedPayload: row?.payloadSealed !== null,
      hasRecipientEmail: row?.recipientEmail !== null,
      hasSubjectEmail: row?.subjectEmail !== null,
      hasSubjectPhone: row?.subjectPhone !== null,
      hasBookingId: row?.bookingId !== null,
      hasRecipientPersonId: row?.recipientPersonId !== null,
      hasRecipientTripId: row?.recipientTripId !== null,
    }).toEqual({
      status: "failed",
      errorCode: "stale_recipient",
      hasSealedPayload: false,
      hasRecipientEmail: false,
      hasSubjectEmail: false,
      hasSubjectPhone: false,
      hasBookingId: false,
      hasRecipientPersonId: false,
      hasRecipientTripId: false,
    });
  });
});
