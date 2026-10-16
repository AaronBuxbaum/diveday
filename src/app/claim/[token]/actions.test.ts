import { afterEach, describe, expect, it, vi } from "vitest";
import { verifyBookingCapability } from "@/db/booking-capabilities";
import { createBookingParty } from "@/db/bookings";
import { issuePartySeatClaims } from "@/db/seat-claims";
import { upcomingTripsWithCounts } from "@/db/trips";
import { fileScopedShopContext } from "@/test/db";

/**
 * **A claimed seat lands on an undelivered link** (security review of layer
 * r5-4, F1). The claim form proves only that the claimant typed a name and an
 * address that match a person on file, so the `/ready` link it redirects to
 * must not open that person's other days; their own mailed links do.
 *
 * The real action on a real database; only the framework edge, the request's
 * IP and locale are stubbed.
 */

const ctx = fileScopedShopContext();

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/client")>();
  return { ...actual, getDb: vi.fn() };
});
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US" as const),
  requestFirstHandLocale: vi.fn(async () => "en-US" as const),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});

const { getDb } = await import("@/db/client");
const { claimSeatAction } = await import("./actions");

afterEach(() => vi.clearAllMocks());

describe("claimSeatAction", () => {
  it("redirects to a readiness link that is not marked delivered", async () => {
    const { db, shop } = ctx;
    vi.mocked(getDb).mockResolvedValue(db);
    const [trip] = await upcomingTripsWithCounts(db, shop.id);
    if (!trip) throw new Error("expected a seeded upcoming trip");
    const party = await createBookingParty(db, [
      {
        actor: "public",
        shopId: shop.id,
        tripId: trip.id,
        fullName: "Orla Organizer",
        email: "orla@example.com",
      },
      { actor: "public", shopId: shop.id, tripId: trip.id, fullName: "Milo Member" },
    ]);
    if (!party.ok) throw new Error(`party booking failed: ${party.reason}`);
    const [lead, member] = party.bookings;
    if (!lead || !member) throw new Error("party booking incomplete");
    const claim = (
      await issuePartySeatClaims(db, { shopId: shop.id, leadBookingId: lead.bookingId })
    ).find((seat) => seat.bookingId === member.bookingId)?.claim;
    if (!claim) throw new Error("expected a claim link for the member seat");

    const form = new FormData();
    form.set("fullName", "Milo Member");
    form.set("email", "milo@example.com");
    const landing = await claimSeatAction(claim.token, form).then(
      () => "",
      (error: unknown) => (error instanceof Error ? error.message : ""),
    );

    const match = /^REDIRECT:\/ready\/([^?]+)/.exec(landing);
    if (!match?.[1]) throw new Error(`the claim did not land on /ready: ${landing}`);
    const opened = await verifyBookingCapability(db, { token: match[1], purpose: "readiness" });
    expect(opened?.bookingId).toBe(member.bookingId);
    expect(opened?.delivered).toBe(false);
  });
});
