// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { HANDOFF_TTL_MS } from "@/lib/booking-handoff";
import { seededShopContext } from "@/test/db";
import {
  consumeBookingHandoff,
  issueBookingHandoff,
  offerBookingHandoffByEmail,
  readKnownDiver,
} from "./booking-handoff";
import { createBooking } from "./bookings";
import type { AppDb } from "./client";
import { shops } from "./schema";
import { upcomingTripsWithCounts } from "./trips";

/**
 * **The door remembers who opened it, and only who opened it** (ADR
 * 20260906-before-you-ask, decision 3). What matters here is the refusals: a
 * handoff answers for its own shop and its own ten minutes, a booking consumes
 * it, and the cold-email link goes once, to the address on file, and says
 * nothing to the page.
 */

const APP_ORIGIN = "https://diveday.test";
const NOW = new Date("2026-08-01T14:00:00Z");

const sent = vi.fn();
vi.mock("./notifications", () => ({
  sendAndRecordNotification: async (db: AppDb, notification: Record<string, unknown>) => {
    sent(notification);
    // The real one records a delivery row, which is what the cooldown reads.
    const { notificationDeliveries } = await import("./schema");
    await db.insert(notificationDeliveries).values({
      shopId: notification.shopId as string,
      bookingId: notification.bookingId as string,
      kind: "booking_handoff",
      status: "sent",
      attemptedAt: new Date(),
    });
    return { status: "sent", providerMessageId: "test" };
  },
}));

beforeEach(() => sent.mockClear());

async function bookedDiver(db: AppDb, shopId: string, tripId: string, email: string) {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Yara Haddad",
    email,
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return outcome.bookingId;
}

async function fixture() {
  const { db, shop } = await seededShopContext();
  const [trip, nextTrip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip || !nextTrip) throw new Error("expected two seeded trips");
  const bookingId = await bookedDiver(db, shop.id, trip.id, "yara@example.com");
  return { db, shop, trip, nextTrip, bookingId };
}

describe("booking handoff", () => {
  it("reads the diver behind a live handoff, and nothing behind a consumed or aged one", async () => {
    const { db, shop, bookingId } = await fixture();
    const issued = await issueBookingHandoff(db, { shopId: shop.id, bookingId, now: NOW });
    if (!issued) throw new Error("expected a handoff");
    expect(issued.expiresAt.getTime()).toBe(NOW.getTime() + HANDOFF_TTL_MS);

    const known = await readKnownDiver(db, { shopId: shop.id, token: issued.token, now: NOW });
    expect(known).toMatchObject({ bookingId, fullName: "Yara Haddad", email: "yara@example.com" });
    expect(Array.isArray(known?.facts)).toBe(true);

    // Ten minutes and a second later it is no token at all.
    expect(
      await readKnownDiver(db, {
        shopId: shop.id,
        token: issued.token,
        now: new Date(NOW.getTime() + HANDOFF_TTL_MS + 1000),
      }),
    ).toBeNull();

    await consumeBookingHandoff(db, { shopId: shop.id, token: issued.token, now: NOW });
    expect(await readKnownDiver(db, { shopId: shop.id, token: issued.token, now: NOW })).toBeNull();
    // Consuming again, or consuming nothing, is a no-op.
    await consumeBookingHandoff(db, { shopId: shop.id, token: "nope", now: NOW });
  });

  it("answers only for its own shop", async () => {
    const { db, shop, bookingId } = await fixture();
    const [other] = await db
      .insert(shops)
      .values({ name: "Other Reef", slug: "other-reef-handoff", timezone: "America/New_York" })
      .returning();
    if (!other) throw new Error("other shop insert failed");
    const issued = await issueBookingHandoff(db, { shopId: shop.id, bookingId, now: NOW });
    if (!issued) throw new Error("expected a handoff");
    expect(
      await readKnownDiver(db, { shopId: other.id, token: issued.token, now: NOW }),
    ).toBeNull();
  });

  it("sends one link to a cold-typed address on file, then holds its tongue for an hour", async () => {
    const { db, shop, nextTrip, bookingId } = await fixture();
    const input = {
      shopId: shop.id,
      tripId: nextTrip.id,
      email: "Yara@Example.com ",
      origin: APP_ORIGIN,
      requestLocale: "en-US" as const,
      now: NOW,
    };
    expect(await offerBookingHandoffByEmail(db, input)).toBe("sent");
    expect(sent).toHaveBeenCalledTimes(1);
    const notification = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(notification.kind).toBe("booking_handoff");
    expect(notification.to).toBe("yara@example.com");
    expect(notification.bookingId).toBe(bookingId);
    expect(String(notification.bookingUrl)).toMatch(
      new RegExp(`^${APP_ORIGIN}/s/${shop.slug}/trips/${nextTrip.id}\\?from=`),
    );

    expect(await offerBookingHandoffByEmail(db, input)).toBe("skipped");
    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("sends nothing for an address the shop does not know, and nothing with no origin", async () => {
    const { db, shop, nextTrip } = await fixture();
    expect(
      await offerBookingHandoffByEmail(db, {
        shopId: shop.id,
        tripId: nextTrip.id,
        email: "stranger@example.com",
        origin: APP_ORIGIN,
        requestLocale: "en-US",
        now: NOW,
      }),
    ).toBe("skipped");
    expect(
      await offerBookingHandoffByEmail(db, {
        shopId: shop.id,
        tripId: nextTrip.id,
        email: "yara@example.com",
        origin: null,
        requestLocale: "en-US",
        now: NOW,
      }),
    ).toBe("skipped");
    expect(sent).not.toHaveBeenCalled();
  });
});
