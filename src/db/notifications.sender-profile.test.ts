import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { nowMs } from "@/lib/clock";
import type { Notification, NotificationProvider } from "@/lib/notifications";
import { fileScopedShopContext } from "@/test/db";
import { createBooking } from "./bookings";
import { drainNotificationRetries, sendNotification } from "./notifications";
import { shops } from "./schema";
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

// ADR 20260902-sender-standards-for-ses: the shop's Reply-To and postal line
// ride every shop-scoped send, resolved here rather than by each composer.
// Amended by ADR 20260907-two-way-inbox: the Reply-To is now the shop's own
// inbound address, so a diver who hits reply lands in the shop's inbox rather
// than in a front-desk mailbox the app cannot see.
describe("the shop's sender profile", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  function capturingProvider(seen: Notification[]): NotificationProvider {
    return {
      async send(notification) {
        seen.push(notification);
        return { status: "sent", providerMessageId: `sent-${seen.length}` };
      },
    };
  }

  it("attaches the shop's inbound reply address and street to a send", async () => {
    const { db, shop, trip, booking } = await seededBooking();
    await db
      .update(shops)
      .set({
        // The demo's logo and colour ride a send too; this test is about the
        // reply address and the street.
        logoUrl: null,
        brandColor: null,
        contactEmail: "desk@bluemantis.dive",
        contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
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
      replyTo: `reply+${shop.inboundEmailToken}@inbound.ses.dive.day`,
      postalAddress: "1 Harbor Rd, Key Largo, FL 33037, US",
      // The sign-off's phone and confirmed address (B31).
      contactPhone: "+1 305 555 0142",
      contactEmail: "desk@bluemantis.dive",
      // The seeded shop is the demo shop, so its sends may reach the simulator.
      demoShop: true,
    });

    // Inbound switched off: the confirmed front desk, resolved from the same
    // row by the same reader, so this layer proves the fallback too.
    vi.stubEnv("EMAIL_INBOUND_DOMAIN", "");
    seen.length = 0;
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
      contactPhone: "+1 305 555 0142",
      contactEmail: "desk@bluemantis.dive",
      demoShop: true,
    });
  });

  it("sends exactly as before for a shop with neither on file, and on a drained retry", async () => {
    // Inbound off, so the front desk is what the sender resolves to and the
    // mid-flight change to it is observable — which is what this test is
    // about: a queued payload carries no sender, and the drain resolves one
    // fresh rather than reusing what was queued.
    vi.stubEnv("EMAIL_INBOUND_DOMAIN", "");
    const { db, shop, trip, booking } = await seededBooking();
    await db
      .update(shops)
      .set({
        logoUrl: null,
        brandColor: null,
        contactEmail: null,
        contactPhone: null,
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
      .set({
        contactEmail: "desk@bluemantis.dive",
        contactEmailConfirmedAt: new Date("2026-09-01T12:00:00.000Z"),
      })
      .where(eq(shops.id, shop.id));
    await drainNotificationRetries(db, {
      provider: capturingProvider(seen),
      now: new Date(nowMs() + 60 * 60 * 1_000),
    });

    // The queued payload carried no sender, so the drain resolved one fresh.
    expect(seen).toHaveLength(1);
    expect(seen[0]?.sender).toEqual({
      replyTo: "desk@bluemantis.dive",
      contactEmail: "desk@bluemantis.dive",
      demoShop: true,
    });
  });
});
