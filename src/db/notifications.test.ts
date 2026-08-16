import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import type { Notification, NotificationDelivery, NotificationProvider } from "@/lib/notifications";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  applyProviderEmailEvent,
  drainNotificationRetries,
  listNotificationDeliveryIssues,
  recordNotificationDelivery,
  retryBookingConfirmation,
  sendNotification,
} from "./notifications";
import {
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  people,
  shops,
} from "./schema";
import { upcomingTripsWithCounts } from "./trips";

async function seededBooking() {
  const { db, shop } = await seededShopContext();
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

describe("notification delivery status", () => {
  it("queues a retryable provider failure and drains it later", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    const notification: Notification = {
      kind: "booking_confirmation",
      bookingId: booking.bookingId,
      shopId: shop.id,
      to: "nora@example.com",
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: shop.name,
      tripTitle: trip.title,
      startsAt: new Date("2026-08-01T12:00:00.000Z"),
      endsAt: new Date("2026-08-01T15:00:00.000Z"),
      timezone: shop.timezone,
    };
    let attempts = 0;
    const provider: NotificationProvider = {
      async send() {
        attempts += 1;
        return attempts === 1
          ? ({
              status: "failed",
              retryable: true,
              httpStatus: 429,
              retryAfterMs: 1,
            } satisfies NotificationDelivery)
          : { status: "sent", providerMessageId: "retry-success" };
      },
    };

    await expect(sendNotification(db, notification, provider)).resolves.toMatchObject({
      status: "failed",
      retryable: true,
    });
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));

    await expect(drainNotificationRetries(db, { provider })).resolves.toMatchObject({
      scanned: 1,
      sent: 1,
    });
    expect(attempts).toBe(2);
    await expect(
      db.select().from(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([
      { status: "sent", providerMessageId: "retry-success", payload: null },
    ]);
  });

  it("clears the payload when a retry reaches a terminal failure", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    const notification: Notification = {
      kind: "booking_confirmation",
      bookingId: booking.bookingId,
      shopId: shop.id,
      to: "nora@example.com",
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: shop.name,
      tripTitle: trip.title,
      startsAt: new Date("2026-08-01T12:00:00.000Z"),
      endsAt: new Date("2026-08-01T15:00:00.000Z"),
      timezone: shop.timezone,
    };
    let attempts = 0;
    const provider: NotificationProvider = {
      async send() {
        attempts += 1;
        return attempts === 1
          ? { status: "failed", retryable: true, errorCode: "temporary_failure" }
          : { status: "failed", retryable: false, errorCode: "permanent_failure" };
      },
    };

    await sendNotification(db, notification, provider);
    await db
      .update(notificationSendQueue)
      .set({ nextAttemptAt: new Date(0) })
      .where(eq(notificationSendQueue.shopId, shop.id));

    await expect(drainNotificationRetries(db, { provider })).resolves.toMatchObject({ failed: 1 });
    await expect(
      db.select().from(notificationSendQueue).where(eq(notificationSendQueue.shopId, shop.id)),
    ).resolves.toMatchObject([{ status: "failed", payload: null, errorCode: "permanent_failure" }]);
  });

  it("shows a failed booking email on the shop dashboard query", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "booking_confirmation",
      delivery: {
        status: "failed",
        retryable: true,
        httpStatus: 429,
        errorCode: "rate_limit_exceeded",
        detail: "slow down",
      },
    });

    await expect(listNotificationDeliveryIssues(db, shop.id)).resolves.toMatchObject([
      {
        // Send diagnostics are distinct from later provider webhook outcomes.
        delivery: {
          kind: "booking_confirmation",
          status: "failed",
          sendHttpStatus: 429,
          sendErrorCode: "rate_limit_exceeded",
          sendError: "slow down",
        },
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

  it("appends an append-only attempt trail and retries a confirmation", async () => {
    const { db, shop, booking } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "booking_confirmation",
      delivery: { status: "failed" },
    });

    // No email provider is configured in tests, so a retry attempt is recorded
    // as not_configured — but it is still a durable, flagged retry attempt.
    const delivery = await retryBookingConfirmation(db, shop.id, booking.bookingId);
    expect(delivery?.status).toBe("not_configured");

    // Read the trail straight off the table, oldest first.
    const attempts = await db
      .select()
      .from(notificationDeliveryAttempts)
      .where(
        and(
          eq(notificationDeliveryAttempts.shopId, shop.id),
          eq(notificationDeliveryAttempts.bookingId, booking.bookingId),
          eq(notificationDeliveryAttempts.kind, "booking_confirmation"),
        ),
      )
      .orderBy(asc(notificationDeliveryAttempts.attemptedAt));
    expect(attempts).toHaveLength(2);
    expect(attempts[0]).toMatchObject({ status: "failed", isRetry: false });
    expect(attempts[1]).toMatchObject({ status: "not_configured", isRetry: true });

    // The dashboard issue reflects the latest status and the attempt count.
    const issues = await listNotificationDeliveryIssues(db, shop.id);
    const issue = issues.find((i) => i.booking.id === booking.bookingId);
    expect(issue?.attempts).toBe(2);
  });
});

describe("provider-reported delivery events", () => {
  async function sentConfirmation(providerMessageId = "resend-message-id") {
    const { db, shop, trip, booking } = await seededBooking();
    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId },
    });
    return { db, shop, trip, booking, providerMessageId };
  }

  it("raises a bounce as a staff issue even though the send itself succeeded", async () => {
    const { db, shop, booking, providerMessageId } = await sentConfirmation();

    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        status: "bounced",
        detail: "mailbox unavailable",
        occurredAt: new Date("2026-07-24T18:00:00.000Z"),
      }),
    ).resolves.toBe("applied");

    const issues = await listNotificationDeliveryIssues(db, shop.id);
    expect(issues).toMatchObject([
      {
        delivery: {
          status: "sent",
          providerStatus: "bounced",
          providerDetail: "mailbox unavailable",
        },
        booking: { id: booking.bookingId },
      },
    ]);
  });

  it("leaves a delivered message off the issue list", async () => {
    const { db, shop, providerMessageId } = await sentConfirmation();
    await applyProviderEmailEvent(db, {
      providerMessageId,
      status: "delivered",
      detail: null,
      occurredAt: new Date("2026-07-24T18:00:00.000Z"),
    });

    await expect(listNotificationDeliveryIssues(db, shop.id)).resolves.toEqual([]);
  });

  it("drops an out-of-order event rather than overwriting a newer outcome", async () => {
    const { db, shop, providerMessageId } = await sentConfirmation();
    await applyProviderEmailEvent(db, {
      providerMessageId,
      status: "bounced",
      detail: "mailbox unavailable",
      occurredAt: new Date("2026-07-24T18:00:00.000Z"),
    });

    // Webhook delivery is at-least-once and unordered: the earlier "we sent it"
    // event can easily arrive after the later bounce.
    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        status: "sent",
        detail: null,
        occurredAt: new Date("2026-07-24T17:00:00.000Z"),
      }),
    ).resolves.toBe("stale");

    const issues = await listNotificationDeliveryIssues(db, shop.id);
    expect(issues[0]?.delivery.providerStatus).toBe("bounced");
  });

  it("drops a late-arriving delivered-then-bounced event as stale, keeping the newer status", async () => {
    const { db, shop, providerMessageId } = await sentConfirmation();
    await applyProviderEmailEvent(db, {
      providerMessageId,
      status: "delivered",
      detail: null,
      occurredAt: new Date("2026-07-24T18:00:00.000Z"),
    });

    // A concurrent webhook delivery for the earlier bounce lands after the
    // later "delivered" event was already applied; the conditional update
    // must reject it rather than let the older event win the race.
    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        status: "bounced",
        detail: "mailbox unavailable",
        occurredAt: new Date("2026-07-24T17:00:00.000Z"),
      }),
    ).resolves.toBe("stale");

    const issues = await listNotificationDeliveryIssues(db, shop.id);
    expect(issues).toEqual([]);
    const [delivery] = await db
      .select({ providerStatus: notificationDeliveries.providerStatus })
      .from(notificationDeliveries)
      .where(eq(notificationDeliveries.providerMessageId, providerMessageId));
    expect(delivery?.providerStatus).toBe("delivered");
  });

  it("reports an unknown message id without failing, so the webhook caller stops retrying", async () => {
    const { db } = await sentConfirmation();
    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId: "a-message-we-never-sent",
        status: "delivered",
        detail: null,
        occurredAt: new Date("2026-07-24T18:00:00.000Z"),
      }),
    ).resolves.toBe("unknown_message");
  });

  it("clears the old bounce when staff re-send the same notification", async () => {
    const { db, shop, booking, providerMessageId } = await sentConfirmation();
    await applyProviderEmailEvent(db, {
      providerMessageId,
      status: "bounced",
      detail: "mailbox unavailable",
      occurredAt: new Date("2026-07-24T18:00:00.000Z"),
    });

    await recordNotificationDelivery(db, {
      shopId: shop.id,
      bookingId: booking.bookingId,
      kind: "booking_confirmation",
      delivery: { status: "sent", providerMessageId: "a-fresh-message-id" },
      isRetry: true,
    });

    // The replacement message has its own provider story; the previous
    // message's bounce must not be shown against it.
    await expect(listNotificationDeliveryIssues(db, shop.id)).resolves.toEqual([]);
  });
});

describe("resend language (docs ADR 20260731-per-person-notification-locale)", () => {
  function capturingProvider() {
    const sent: Notification[] = [];
    const provider: NotificationProvider = {
      async send(notification) {
        sent.push(notification);
        return { status: "sent", providerMessageId: "em_resend" };
      },
    };
    return { sent, provider };
  }

  it("writes a staff-triggered resend in the diver's language, not the staff member's", async () => {
    // Staff press "resend" from the notifications dashboard, so the request's
    // own Accept-Language belongs to *them*. The mail still lands in the
    // diver's inbox, so it follows what the diver told us on their own booking.
    const { db, shop, booking } = await seededBooking();
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ locale: "en-US" }).where(eq(people.email, "nora@example.com"));

    const { sent, provider } = capturingProvider();
    await retryBookingConfirmation(db, shop.id, booking.bookingId, provider);
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ kind: "booking_confirmation", locale: "en-US" });
  });

  it("falls back to the shop's locale for a diver DiveDay has never heard from", async () => {
    const { db, shop, booking } = await seededBooking();
    await db.update(shops).set({ defaultLocale: "es-ES" }).where(eq(shops.id, shop.id));
    await db.update(people).set({ locale: null }).where(eq(people.email, "nora@example.com"));

    const { sent, provider } = capturingProvider();
    await retryBookingConfirmation(db, shop.id, booking.bookingId, provider);
    expect(sent[0]).toMatchObject({ locale: "es-ES" });
  });
});
