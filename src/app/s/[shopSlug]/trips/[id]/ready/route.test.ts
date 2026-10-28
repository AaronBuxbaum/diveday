import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { bookingCapabilities, bookings, people } from "@/db/schema";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

const exchangeHooks = vi.hoisted(() => ({
  afterVerify: null as
    | ((capability: {
        bookingId: string;
        shopId: string;
        personId: string;
        tripId: string;
      }) => Promise<void>)
    | null,
}));

const ctx = fileScopedShopContext();
const CALLER_IP = "203.0.113.7";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/db/booking-capabilities", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/booking-capabilities")>();
  return {
    ...actual,
    verifyBookingCapability: vi.fn(async (db, input) => {
      const capability = await actual.verifyBookingCapability(db, input);
      if (capability) await exchangeHooks.afterVerify?.(capability);
      return capability;
    }),
  };
});
vi.mock("next/headers", () => nextHeadersStub({ headers: { "x-forwarded-for": CALLER_IP } }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { issueBookingCapability, verifyBookingCapability } = await import(
  "@/db/booking-capabilities"
);
const { GET } = await import("./route");

async function fixture() {
  const { db, shop } = ctx;
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("test departure missing");
  const [booking] = await db
    .select({ id: bookings.id, personId: bookings.personId })
    .from(bookings)
    .where(and(eq(bookings.shopId, shop.id), eq(bookings.tripId, trip.id)))
    .limit(1);
  if (!booking) throw new Error("test booking missing");
  const confirm = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: booking.id,
    purpose: "confirm",
  });
  if (!confirm) throw new Error("confirm capability was not issued");
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, shop, trip, booking, token: confirm.token };
}

async function exchange(shopSlug: string, tripId: string, token: string) {
  return GET(
    new NextRequest(
      `http://localhost/s/${shopSlug}/trips/${tripId}/ready?booking=${encodeURIComponent(token)}`,
    ),
    { params: Promise.resolve({ shopSlug, id: tripId }) },
  );
}

afterEach(() => {
  exchangeHooks.afterVerify = null;
  vi.clearAllMocks();
});

describe("GET /s/[shopSlug]/trips/[id]/ready", () => {
  it("exchanges a live confirm capability for readiness on the same booking", async () => {
    const { db, shop, trip, booking, token } = await fixture();

    const response = await exchange(shop.slug, trip.id, token);

    expect(response.status).toBe(307);
    const location = response.headers.get("Location");
    expect(location).toMatch(/^http:\/\/localhost\/ready\//);
    const readinessToken = location?.split("/ready/")[1]?.split(/[?#]/)[0];
    if (!readinessToken) throw new Error("readiness exchange did not redirect with a token");
    expect(
      await verifyBookingCapability(db, { token: readinessToken, purpose: "readiness" }),
    ).toMatchObject({
      bookingId: booking.id,
      personId: booking.personId,
      tripId: trip.id,
    });
  });

  it("falls back to the trip page when the booking is repointed after verification", async () => {
    const { db, shop, trip, booking, token } = await fixture();
    exchangeHooks.afterVerify = async (capability) => {
      if (capability.bookingId !== booking.id) return;
      const [replacement] = await db
        .insert(people)
        .values({
          shopId: shop.id,
          fullName: "Replacement Diver",
          email: "replacement@example.com",
        })
        .returning({ id: people.id });
      if (!replacement) throw new Error("replacement person was not created");
      await db
        .update(bookings)
        .set({ personId: replacement.id })
        .where(eq(bookings.id, booking.id));
    };

    const response = await exchange(shop.slug, trip.id, token);

    expect(response.status).toBe(307);
    expect(response.headers.get("Location")).toBe(
      `http://localhost/s/${shop.slug}/trips/${trip.id}`,
    );
    const readiness = await db
      .select({ id: bookingCapabilities.id })
      .from(bookingCapabilities)
      .where(
        and(
          eq(bookingCapabilities.bookingId, booking.id),
          eq(bookingCapabilities.purpose, "readiness"),
        ),
      );
    expect(readiness).toEqual([]);
  });
});
