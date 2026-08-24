// @vitest-environment node
import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { nowDate } from "@/lib/clock";
import { seededShopContext } from "@/test/db";
import { cancelBooking, createBooking } from "./bookings";
import type { AppDb } from "./client";
import { sendFindMyBookingLinks } from "./find-my-booking";
import { activityEvents, bookings, trips } from "./schema";
import { setTripStatus, upcomingTripsWithCounts } from "./trips";

const failBooking = vi.hoisted(() => ({ id: null as string | null }));

// Wraps `issueBookingCapability` so a single test can make one *specific*
// booking's mint throw, to prove the per-booking isolation Finding 2 asked
// for — everything else (including `hasLiveReadinessCapability` and
// `revokeBookingCapabilities`, which most tests below still use directly)
// passes through to the real module untouched.
vi.mock("./booking-capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./booking-capabilities")>();
  return {
    ...actual,
    issueBookingCapability: vi.fn(async (db: unknown, input: { bookingId: string }) => {
      if (input.bookingId === failBooking.id) throw new Error("simulated mint failure");
      return actual.issueBookingCapability(db as never, input as never);
    }),
  };
});

const { hasLiveReadinessCapability, issueBookingCapability, revokeBookingCapabilities } =
  await import("./booking-capabilities");

/**
 * **What "Can't find your link?" is allowed to do, and what it must not**
 * (issue #723). This function is never awaited by the response its caller
 * sends — `requestFindMyBookingAction`'s identical-response guarantee lives
 * there, not here — so these tests are about the mail it actually sends: only
 * to the stored address, only for a current booking on a future departure,
 * and never twice while a link is already live.
 */

const APP_ORIGIN = "https://diveday.test";

const sent = vi.fn();
vi.mock("./notifications", () => ({
  sendAndRecordNotification: (_db: unknown, notification: unknown) => {
    sent(notification);
    return Promise.resolve({ status: "sent", providerMessageId: "test" });
  },
}));

// The per-inbox rate limit these tests would otherwise share (a real,
// process-wide in-memory bucket keyed by email) is out of scope for most of
// these tests — mocked to always-allow here, and overridden per-test below
// for the two tests that are specifically about this limiter.
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })),
  };
});

const { checkRateLimit } = await import("@/lib/rate-limit");

beforeEach(() => {
  sent.mockClear();
  failBooking.id = null;
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
});

async function bookedDiver(db: AppDb, shopId: string, tripId: string, email = "nora@example.com") {
  const outcome = await createBooking(db, {
    actor: "staff",
    shopId,
    tripId,
    fullName: "Nora Quinn",
    email,
  });
  if (!outcome.ok) throw new Error("expected booking to succeed");
  return outcome.bookingId;
}

describe("sendFindMyBookingLinks", () => {
  it("mails a fresh readiness link for a current booking on a future departure", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).toHaveBeenCalledTimes(1);
    const notification = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(notification.kind).toBe("readiness_link");
    // Only ever to the stored address, whatever case the request typed.
    expect(notification.to).toBe("nora@example.com");
    expect(notification.bookingId).toBe(bookingId);
  });

  it("matches the stored address case-insensitively but never mails what the caller typed", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    await bookedDiver(db, shop.id, trip.id, "Nora@Example.com");

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "NORA@EXAMPLE.COM",
      origin: APP_ORIGIN,
    });

    expect(sent).toHaveBeenCalledTimes(1);
    const notification = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(notification.to).toBe("nora@example.com");
  });

  it("sends nothing for an address with no booking at this shop", async () => {
    const { db, shop } = await seededShopContext();
    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nobody@example.com",
      origin: APP_ORIGIN,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not reissue a booking whose departure has already sailed past the buffer", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    await bookedDiver(db, shop.id, trip.id);
    // Two hours past departure — outside the 1-hour late-arrival buffer every
    // "has this sailed" check in this app applies (AGENTS.md). Both columns
    // move together so the trip keeps a positive duration
    // (`trips_ends_after_starts`).
    const now = nowDate();
    const shiftMs = now.getTime() - 2 * 60 * 60 * 1000 - trip.startsAt.getTime();
    await db
      .update(trips)
      .set({
        startsAt: new Date(trip.startsAt.getTime() + shiftMs),
        endsAt: new Date(trip.endsAt.getTime() + shiftMs),
      })
      .where(eq(trips.id, trip.id));

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
      now,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not reissue a cancelled booking", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);
    await cancelBooking(db, shop.id, bookingId);

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not reissue a booking on a cancelled trip", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    await bookedDiver(db, shop.id, trip.id);
    await setTripStatus(db, shop.id, trip.id, "cancelled");

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });
    expect(sent).not.toHaveBeenCalled();
  });

  it("does not reissue, and does not spend a live slot, when a live readiness link already exists", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).not.toHaveBeenCalled();
    expect(
      await hasLiveReadinessCapability(db, { shopId: shop.id, bookingId, now: nowDate() }),
    ).toBe(true);
  });

  it("re-sends once the booking's only link has gone dead", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);
    const issued = await issueBookingCapability(db, {
      shopId: shop.id,
      bookingId,
      purpose: "readiness",
    });
    if (!issued) throw new Error("expected a capability");
    // Revoked rather than aged out, same as readiness-link-rescue.test.ts's
    // `bookingWithDeadLink`: identical deadness, and it leaves the trip's own
    // departure window untouched, which advancing the clock to `expiresAt`
    // would not (readiness capabilities can outlive a near-term departure).
    await revokeBookingCapabilities(db, { shopId: shop.id, bookingId, purpose: "readiness" });

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).toHaveBeenCalledTimes(1);
  });

  it("mails one link per current booking, never a digest of every trip the address has", async () => {
    const { db, shop } = await seededShopContext();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    if (upcoming.length < 2) throw new Error("expected at least two seeded upcoming trips");
    await bookedDiver(db, shop.id, upcoming[0].id);
    await bookedDiver(db, shop.id, upcoming[1].id);

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).toHaveBeenCalledTimes(2);
    const bookingIds = sent.mock.calls.map(
      (call) => (call[0] as Record<string, unknown>).bookingId,
    );
    expect(new Set(bookingIds).size).toBe(2);
  });

  it("quietly records the re-request on the trip's own activity trail", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    const [booking] = await db
      .select({ personId: bookings.personId })
      .from(bookings)
      .where(eq(bookings.id, bookingId));
    const events = await db
      .select()
      .from(activityEvents)
      .where(and(eq(activityEvents.shopId, shop.id), eq(activityEvents.tripId, trip.id)));
    const line = events.find((event) => event.actorPersonId === booking?.personId);
    expect(line?.message).toContain("requested a fresh link");
  });

  /**
   * **Finding 1** (`security-reviewer`, issue #723): the per-inbox limiter
   * must be spent only once real work is pending, never merely by an email
   * being well-formed and unthrottled by IP — a live readiness capability is
   * the common case for a healthy booking, so spending upfront would let
   * anyone who merely knows an address drain a diver's own recovery budget
   * with submissions that mint nothing.
   */
  it("does not spend the per-inbox rate limit when every matching booking already has a live link", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    const bookingId = await bookedDiver(db, shop.id, trip.id);
    await issueBookingCapability(db, { shopId: shop.id, bookingId, purpose: "readiness" });
    vi.mocked(checkRateLimit).mockClear();

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).not.toHaveBeenCalled();
    expect(checkRateLimit).not.toHaveBeenCalled();
  });

  it("spends the per-inbox rate limit once real work is pending, and honors it", async () => {
    const { db, shop } = await seededShopContext();
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded trip");
    await bookedDiver(db, shop.id, trip.id);
    vi.mocked(checkRateLimit).mockResolvedValueOnce({ allowed: false, retryAfterMs: 60_000 });

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(checkRateLimit).toHaveBeenCalledTimes(1);
    expect(sent).not.toHaveBeenCalled();
  });

  /**
   * **Finding 2** (`security-reviewer`, issue #723): one booking's mint
   * throwing — a lock-wait or serialization failure under concurrent
   * requests is a real trigger, not just a hypothetical — must not silently
   * stop every booking after it for the same address.
   */
  it("isolates one booking's mint failure from the rest of the same address's bookings", async () => {
    const { db, shop } = await seededShopContext();
    const upcoming = await upcomingTripsWithCounts(db, shop.id);
    if (upcoming.length < 2) throw new Error("expected at least two seeded upcoming trips");
    const failingBookingId = await bookedDiver(db, shop.id, upcoming[0].id);
    const okBookingId = await bookedDiver(db, shop.id, upcoming[1].id);
    failBooking.id = failingBookingId;

    await sendFindMyBookingLinks(db, {
      shopId: shop.id,
      email: "nora@example.com",
      origin: APP_ORIGIN,
    });

    expect(sent).toHaveBeenCalledTimes(1);
    const notification = sent.mock.calls[0]?.[0] as Record<string, unknown>;
    expect(notification.bookingId).toBe(okBookingId);
    expect(
      await hasLiveReadinessCapability(db, {
        shopId: shop.id,
        bookingId: failingBookingId,
        now: nowDate(),
      }),
    ).toBe(false);
  });
});
