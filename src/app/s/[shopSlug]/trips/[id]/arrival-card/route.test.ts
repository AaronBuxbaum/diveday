import { and, eq } from "drizzle-orm";
import { NextRequest } from "next/server";
import QRCode from "qrcode";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { issueBookingCapability, verifyBookingCapability } from "@/db/booking-capabilities";
import { cancelBooking } from "@/db/bookings";
import type { AppDb } from "@/db/client";
import { bookingCapabilities } from "@/db/schema";
import { getTripRoster, upcomingTripsWithCounts } from "@/db/trips";
import { seededShopContext } from "@/test/db";
import { nextHeadersStub } from "@/test/next-headers";

vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
// `requestLocale` reads both `headers()` and `cookies()`, which resolve only
// inside a real Next request scope — absent here, since the handler is called
// directly. An empty request negotiates down to the shop's default locale.
vi.mock("next/headers", () => nextHeadersStub());

const { getDb } = await import("@/db/client");
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
    .select({ id: bookingCapabilities.id })
    .from(bookingCapabilities)
    .where(
      and(eq(bookingCapabilities.bookingId, bookingId), eq(bookingCapabilities.purpose, "arrival")),
    );
}

describe("GET /s/[shopSlug]/trips/[id]/arrival-card", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
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

  it("refuses a cancelled booking, and mints nothing", async () => {
    const { db, shop, trip, bookingId, token } = await bookedDiver();
    await cancelBooking(db, shop.id, bookingId);

    const response = await card(shop.slug, trip.id, token);

    expect(response.status).toBe(404);
    await expect(arrivalRows(db, bookingId)).resolves.toHaveLength(0);
  });
});
