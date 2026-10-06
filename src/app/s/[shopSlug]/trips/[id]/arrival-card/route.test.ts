import { eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability } from "@/db/booking-capabilities";
import { cancelBooking } from "@/db/bookings";
import { bookingCapabilities } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { publicAppUrl } from "@/lib/notifications/app-url";
import { seededShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

const CALLER_IP = "203.0.113.7";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// `requestLocale` reads both `headers()` and `cookies()`, which resolve only
// inside a real Next request scope — absent here, since the handler is called
// directly. The request asks for no language, so it negotiates down to the
// shop's default locale; the forwarded address is what `clientIp` buckets the
// throttle on.
vi.mock("next/headers", () => nextHeadersStub({ headers: { "x-forwarded-for": CALLER_IP } }));
// Partially mocked so a test can empty the bucket: the real token bucket would
// need sixty calls to say no, and what is worth pinning is the refusal, not
// the arithmetic (`rate-limit.test.ts` owns that).
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn() };
});

const { getDb } = await import("@/db/client");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { GET } = await import("./route");

/**
 * The seeded shop, one scheduled departure, one booked diver on it, and a live
 * `readiness` capability over that booking — the exact position a diver is in
 * when `/ready` offers them the download.
 */
async function bookedDiver() {
  const { db, shop } = await seededShopContext();
  const [trip] = await upcomingTripsWithCounts(db, shop.id);
  if (!trip) throw new Error("demo trip missing");
  const [entry] = await getTripRoster(db, shop.id, trip.id);
  if (!entry) throw new Error("demo booking missing");
  const readiness = await issueBookingCapability(db, {
    shopId: shop.id,
    bookingId: entry.booking.id,
    purpose: "readiness",
  });
  if (!readiness) throw new Error("readiness capability not issued");
  vi.mocked(getDb).mockResolvedValue(db);
  return { db, shop, trip, bookingId: entry.booking.id, token: readiness.token };
}

function card(shopSlug: string, tripId: string, token?: string) {
  const query = token === undefined ? "" : `?booking=${encodeURIComponent(token)}`;
  return GET(
    new NextRequest(`http://localhost/s/${shopSlug}/trips/${tripId}/arrival-card${query}`),
    {
      params: Promise.resolve({ shopSlug, id: tripId }),
    },
  );
}

describe("GET /s/[shopSlug]/trips/[id]/arrival-card", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  });

  it("returns the diver's own card as an attachment", async () => {
    const { shop, trip, token } = await bookedDiver();

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment/);
    // `private, no-store`: the request carried a bearer credential, so its
    // answer stays out of every shared cache.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
  });

  /**
   * The card is a file a diver saves, prints and can forward, so nothing on it
   * may buy anything: not the readiness token that authorized the download
   * (their medical, waiver and payment surface), and not the booking's id.
   */
  it("carries no credential and no database id", async () => {
    const { shop, trip, bookingId, token } = await bookedDiver();

    const body = await (await card(shop.slug, trip.id, token)).text();

    expect(body).not.toContain(token);
    expect(body).not.toContain(encodeURIComponent(token));
    expect(body).not.toContain(bookingId);
    expect(body).not.toContain("<img");
  });

  it("refuses a request with no booking token", async () => {
    const { shop, trip } = await bookedDiver();

    const response = await card(shop.slug, trip.id);

    expect(response.status).toBe(404);
  });

  it("refuses a revoked token", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    await db
      .update(bookingCapabilities)
      .set({ revokedAt: new Date() })
      .where(eq(bookingCapabilities.bookingId, bookingId));

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
  });

  it("refuses a token replayed under another shop's slug", async () => {
    const { shop, trip, token } = await bookedDiver();
    expect(shop.slug).not.toBe("reef-runners");

    const response = await card("reef-runners", trip.id, token);

    expect(response.status).toBe(404);
  });

  it("refuses a throttled caller with the same 404", async () => {
    const { shop, trip, token } = await bookedDiver();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
  });

  it("spends the shared capability budget before the token is verified", async () => {
    const { shop, trip } = await bookedDiver();

    // A token that resolves to nothing: the budget is spent anyway, or this
    // door would be free to whoever is walking tokens rather than holding one.
    await card(shop.slug, trip.id, "not-a-real-token");

    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("arrival-card", CALLER_IP),
      RATE_LIMITS.capabilityAction,
    );
  });

  /**
   * **The card is paper, so its one link is on the canonical origin.** The
   * request here arrives on `http://localhost`; whatever host a download
   * happens to be made through — a preview deployment, a proxy, a forged
   * `Host` — must not be what a diver's saved file points at, because nobody
   * can correct a printed page afterwards (`security-reviewer`, issue #1600).
   */
  it("links the trip on the canonical origin, never the request's host", async () => {
    const { shop, trip, token } = await bookedDiver();

    const body = await (await card(shop.slug, trip.id, token)).text();

    expect(publicAppUrl()).toBe("https://dive.day");
    expect(body).toContain(`href="https://dive.day/s/${shop.slug}/trips/${trip.id}"`);
    expect(body).not.toContain("http://localhost");
  });

  it("refuses a canceled booking", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    await cancelBooking(db, shop.id, bookingId);

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
  });
});
