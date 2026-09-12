import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { cancelBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { bookingCapabilities } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { arrivalCardExpiryFor, capabilityExpiryFor } from "@/lib/booking-capabilities";
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

/** Every live `arrival` capability this booking holds. */
async function arrivalRows(db: AppDb, bookingId: string) {
  return db
    .select({ id: bookingCapabilities.id, expiresAt: bookingCapabilities.expiresAt })
    .from(bookingCapabilities)
    .where(
      and(eq(bookingCapabilities.bookingId, bookingId), eq(bookingCapabilities.purpose, "arrival")),
    );
}

describe("GET /s/[shopSlug]/trips/[id]/arrival-card", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  });

  it("returns the diver's own card as an attachment, with the code drawn into it", async () => {
    const { shop, trip, token } = await bookedDiver();

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Disposition")).toMatch(/attachment/);
    // `private, no-store` is the half of the design that keeps a bearer
    // credential out of a shared cache; it predates the code and must survive it.
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    const body = await response.text();
    // Unescaped on purpose: escaping our own base64 would break the image.
    expect(body).toContain('<img src="data:image/png;base64,');
    expect(body).toContain("Your arrival code");
  });

  /**
   * **The security property of this ticket, pinned.**
   *
   * The card is a file a diver saves, prints and can forward. What travels on
   * that paper must buy recognition at the counter and nothing else — not the
   * readiness surface (medical, waiver, payment) that the `?booking=` token in
   * the URL opens. So the code is a *different* credential on a *different*
   * purpose, and this is the test that says so.
   */
  it("draws an arrival credential, never the readiness token that authorized the download", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    const drawn = vi.spyOn(QRCode, "toDataURL");

    await card(shop.slug, trip.id, token);

    expect(drawn).toHaveBeenCalledTimes(1);
    const payload = drawn.mock.calls[0]?.[0] as string;
    expect(payload).not.toBe(token);

    await expect(
      verifyBookingCapability(db, { token: payload, purpose: "arrival" }),
    ).resolves.toMatchObject({ bookingId });
    await expect(
      verifyBookingCapability(db, { token: payload, purpose: "readiness" }),
    ).resolves.toBeNull();
  });

  /**
   * **A printed credential must not outlive the morning it is for.**
   *
   * The card left with the trip-anchored default — trip end plus thirty days —
   * so a seat booked a season out printed a code that scanned for the season
   * and a month after it (`security-reviewer`, issue #1600). The only door that
   * accepts it is the kiosk, which looks a few hours either side of a
   * departure, so the credential is cut to that and nothing wider.
   */
  it("mints a code bounded to the departure, not to the trip-anchored default", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();

    await card(shop.slug, trip.id, token);

    const [row] = await arrivalRows(db, bookingId);
    expect(row?.expiresAt).toEqual(arrivalCardExpiryFor(trip.startsAt));
    expect(row?.expiresAt.getTime()).toBeLessThan(
      capabilityExpiryFor(trip.endsAt, new Date()).getTime(),
    );
  });

  it("never prints the booking's database id on the card", async () => {
    const { shop, trip, bookingId, token } = await bookedDiver();

    const body = await (await card(shop.slug, trip.id, token)).text();

    expect(body).not.toContain(bookingId);
  });

  it("refuses a request with no booking token, and mints nothing", async () => {
    const { db, shop, trip, bookingId } = await bookedDiver();

    const response = await card(shop.slug, trip.id);

    expect(response.status).toBe(404);
    await expect(arrivalRows(db, bookingId)).resolves.toHaveLength(0);
  });

  it("refuses a revoked token, and mints nothing", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    await db
      .update(bookingCapabilities)
      .set({ revokedAt: new Date() })
      .where(eq(bookingCapabilities.bookingId, bookingId));

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
    await expect(arrivalRows(db, bookingId)).resolves.toHaveLength(0);
  });

  it("refuses a token replayed under another shop's slug", async () => {
    const { shop, trip, token } = await bookedDiver();
    expect(shop.slug).not.toBe("reef-runners");

    const response = await card("reef-runners", trip.id, token);

    expect(response.status).toBe(404);
  });

  /**
   * **A readiness link is not a budget.** Anyone holding one — they are
   * re-tapped all week and forwarded in inboxes — could loop this GET, and
   * every pass rasterizes a code and writes a capability row that
   * `src/lib/retention.ts` never prunes; past
   * `MAX_LIVE_CAPABILITIES_PER_PURPOSE` the loop starts revoking the card the
   * diver already printed for tomorrow morning.
   */
  it("refuses a throttled caller with the same 404, and mints nothing", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 60_000 });

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
    await expect(arrivalRows(db, bookingId)).resolves.toHaveLength(0);
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

  it("refuses a cancelled booking, and mints nothing", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    await cancelBooking(db, shop.id, bookingId);

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
    await expect(arrivalRows(db, bookingId)).resolves.toHaveLength(0);
  });
});
