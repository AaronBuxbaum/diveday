import { and, asc, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { nowMs } from "@/lib/clock";
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
  bookings,
  notificationDeliveries,
  notificationDeliveryAttempts,
  notificationSendQueue,
  people,
  shops,
  waiverRecords,
  waiverTemplates,
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

// ADR 20260902-sender-standards-for-ses: the shop's Reply-To and postal line
// ride every shop-scoped send, resolved here rather than by each composer.
describe("the shop's sender profile", () => {
  function capturingProvider(seen: Notification[]): NotificationProvider {
    return {
      async send(notification) {
        seen.push(notification);
        return { status: "sent", providerMessageId: `sent-${seen.length}` };
      },
    };
  }

  it("attaches the shop's front-desk address and street to a send", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    await db
      .update(shops)
      .set({
        contactEmail: "desk@bluemantis.dive",
        addressStreet: "1 Harbor Rd",
        addressLocality: "Key Largo",
        addressRegion: "FL",
        addressPostalCode: "33037",
        addressCountry: "US",
      })
      .where(eq(shops.id, shop.id));
    const seen: Notification[] = [];

    await sendNotification(
      db,
      {
        kind: "booking_confirmation",
        bookingId: booking.bookingId,
        shopId: shop.id,
        to: "nora@dive.day",
        locale: "en-US",
        diverName: "Nora Quinn",
        shopName: shop.name,
        tripTitle: trip.title,
        startsAt: trip.startsAt,
        endsAt: trip.endsAt,
        timezone: shop.timezone,
      },
      capturingProvider(seen),
    );

    expect(seen[0]?.sender).toEqual({
      replyTo: "desk@bluemantis.dive",
      postalAddress: "1 Harbor Rd, Key Largo, FL 33037, US",
    });
  });

  it("sends exactly as before for a shop with neither on file, and on a drained retry", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    await db
      .update(shops)
      .set({
        contactEmail: null,
        addressStreet: null,
        addressLocality: null,
        addressRegion: null,
        addressPostalCode: null,
        addressCountry: null,
      })
      .where(eq(shops.id, shop.id));
    const notification: Notification = {
      kind: "booking_confirmation",
      bookingId: booking.bookingId,
      shopId: shop.id,
      to: "nora@dive.day",
      locale: "en-US",
      diverName: "Nora Quinn",
      shopName: shop.name,
      tripTitle: trip.title,
      startsAt: trip.startsAt,
      endsAt: trip.endsAt,
      timezone: shop.timezone,
    };
    const seen: Notification[] = [];
    const failing: NotificationProvider = {
      async send() {
        return { status: "failed", retryable: true, httpStatus: 503 };
      },
    };

    await sendNotification(db, notification, failing);
    await db
      .update(shops)
      .set({ contactEmail: "desk@bluemantis.dive" })
      .where(eq(shops.id, shop.id));
    await drainNotificationRetries(db, {
      provider: capturingProvider(seen),
      now: new Date(nowMs() + 60 * 60 * 1_000),
    });

    // The queued payload carried no sender, so the drain resolved one fresh.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sender).toEqual({ replyTo: "desk@bluemantis.dive" });
  });
});

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

  async function independentWaiverDelivery(providerMessageId = "waiver-message-id") {
    const { db, shop, booking } = await seededBooking();
    const [bookingRow] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, booking.bookingId))
      .limit(1);
    if (!bookingRow) throw new Error("booking row missing");
    const [template] = await db
      .select()
      .from(waiverTemplates)
      .where(eq(waiverTemplates.shopId, shop.id))
      .limit(1);
    if (!template) throw new Error("waiver template missing");
    const [record] = await db
      .insert(waiverRecords)
      .values({
        shopId: shop.id,
        bookingId: null,
        personId: bookingRow.personId,
        templateId: template.id,
        templateTitle: template.title,
        templateVersion: template.version,
        templateBody: template.body,
        tokenHash: `test-token-${providerMessageId}`,
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        deliveryProviderMessageId: providerMessageId,
      })
      .returning({ id: waiverRecords.id });
    if (!record) throw new Error("waiver record insert failed");
    return { db, shop, booking, providerMessageId, recordId: record.id };
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

  it("reports stale for out-of-order duplicate events on independent waivers", async () => {
    const { db, recordId, providerMessageId } = await independentWaiverDelivery();
    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        status: "delivered",
        detail: null,
        occurredAt: new Date("2026-07-24T18:00:00.000Z"),
      }),
    ).resolves.toBe("applied");
    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        status: "bounced",
        detail: "mailbox unavailable",
        occurredAt: new Date("2026-07-24T17:00:00.000Z"),
      }),
    ).resolves.toBe("stale");
    const [record] = await db
      .select({ status: waiverRecords.deliveryProviderStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, recordId));
    expect(record?.status).toBe("delivered");
  });

  it("scopes independent-waiver provider events to the given shop", async () => {
    const providerMessageId = "shared-provider-message-id";
    const { db, shop } = await independentWaiverDelivery(providerMessageId);
    const [otherShop] = await db
      .insert(shops)
      .values({ name: "Other Shop", slug: "other-shop-provider-scope", timezone: "UTC" })
      .returning();
    if (!otherShop) throw new Error("second shop insert failed");
    const [otherPerson] = await db
      .insert(people)
      .values({ shopId: otherShop.id, fullName: "Other Diver" })
      .returning();
    if (!otherPerson) throw new Error("second shop person insert failed");
    const [otherTemplate] = await db
      .insert(waiverTemplates)
      .values({
        shopId: otherShop.id,
        title: "Other waiver",
        body: "Other waiver template body.",
        version: 1,
      })
      .returning();
    if (!otherTemplate) throw new Error("second shop template insert failed");
    const [otherRecord] = await db
      .insert(waiverRecords)
      .values({
        shopId: otherShop.id,
        bookingId: null,
        personId: otherPerson.id,
        templateId: otherTemplate.id,
        templateTitle: otherTemplate.title,
        templateVersion: otherTemplate.version,
        templateBody: otherTemplate.body,
        tokenHash: "other-shop-token-hash",
        expiresAt: new Date("2027-01-01T00:00:00.000Z"),
        deliveryProviderMessageId: providerMessageId,
      })
      .returning({ id: waiverRecords.id });
    if (!otherRecord) throw new Error("second shop waiver insert failed");

    await expect(
      applyProviderEmailEvent(db, {
        providerMessageId,
        shopId: shop.id,
        status: "bounced",
        detail: "mailbox unavailable",
        occurredAt: new Date("2026-07-24T18:00:00.000Z"),
      }),
    ).resolves.toBe("applied");

    const [updatedOwn] = await db
      .select({ status: waiverRecords.deliveryProviderStatus })
      .from(waiverRecords)
      .where(
        and(
          eq(waiverRecords.shopId, shop.id),
          eq(waiverRecords.deliveryProviderMessageId, providerMessageId),
        ),
      );
    const [updatedOther] = await db
      .select({ status: waiverRecords.deliveryProviderStatus })
      .from(waiverRecords)
      .where(eq(waiverRecords.id, otherRecord.id));
    expect(updatedOwn?.status).toBe("bounced");
    expect(updatedOther?.status).toBeNull();
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
