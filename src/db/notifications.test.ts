// @vitest-environment node
import { describe, expect, it } from "vitest";
import { seededShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import {
  applyProviderEmailEvent,
  listDeliveryAttempts,
  listNotificationDeliveryIssues,
  recordNotificationDelivery,
  retryBookingConfirmation,
} from "./notifications";
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

    const attempts = await listDeliveryAttempts(
      db,
      shop.id,
      booking.bookingId,
      "booking_confirmation",
    );
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

  it("reports an unknown message id without failing, so Resend stops retrying", async () => {
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
