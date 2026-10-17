import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Issue #2474: a party lead pays for one seat they added, from a bearer-token
 * page. The action spends the per-IP booking bucket, honours the page's own
 * gate, and hands the db function the lead and the seat; which seats are
 * chargeable is pinned in `src/db/party-seat-checkout.test.ts`.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/party-seat-checkout", () => ({ startPartySeatCheckout: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/notifications", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/notifications")>();
  return { ...actual, publicAppUrl: vi.fn(() => "https://diveday.example") };
});
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("./action-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-helpers")>();
  return { ...actual, contextFor: vi.fn() };
});

const { startPartySeatCheckout } = await import("@/db/party-seat-checkout");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { contextFor } = await import("./action-helpers");
const { payForPartySeatFromReady } = await import("./booking-actions");

const TOKEN = "ready-token";
const LEAD = "0f2a9c1e-1111-4222-8333-444444444444";
const SEAT = "0f2a9c1e-5555-4666-8777-888888888888";

function form(seat: string | null): FormData {
  const data = new FormData();
  if (seat !== null) data.set("seatBookingId", seat);
  return data;
}

async function redirectedTo(seat: string | null = SEAT): Promise<string> {
  try {
    await payForPartySeatFromReady(TOKEN, form(seat));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

function context(over: Record<string, unknown> = {}) {
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: LEAD,
    ownLocale: null,
    delivered: false,
    data: {
      canPayPartySeats: true,
      identityHeld: false,
      person: { email: "lead@example.com" },
      shop: { id: "shop-1", defaultLocale: "en-US" },
      trip: { id: "trip-1" },
      ...over,
    } as never,
  });
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  context();
  vi.mocked(startPartySeatCheckout).mockResolvedValue({
    ok: true,
    reused: false,
    checkout: { checkoutUrl: "https://checkout.example/pay" },
  } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("payForPartySeatFromReady", () => {
  it("opens a checkout for the named seat, led by this booking, returning to the party panel", async () => {
    await expect(redirectedTo()).resolves.toBe("https://checkout.example/pay");
    expect(startPartySeatCheckout).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({
        shopId: "shop-1",
        tripId: "trip-1",
        leadBookingId: LEAD,
        seatBookingId: SEAT,
        customerEmail: "lead@example.com",
        successUrl: `https://diveday.example/ready/${TOKEN}?pay=seat-paid#party-seats`,
      }),
    );
  });

  it("charges nothing when the page would not have drawn the button", async () => {
    context({ canPayPartySeats: false });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=seat-pay`);
    expect(startPartySeatCheckout).not.toHaveBeenCalled();
  });

  it("charges nothing without a seat id in the post", async () => {
    await expect(redirectedTo(null)).resolves.toBe(`/ready/${TOKEN}?error=seat-pay`);
    expect(startPartySeatCheckout).not.toHaveBeenCalled();
  });

  it("charges nothing on a held seat", async () => {
    context({ identityHeld: true });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}`);
    expect(startPartySeatCheckout).not.toHaveBeenCalled();
  });

  it("charges nothing once the per-IP bucket is empty", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=rate`);
    expect(startPartySeatCheckout).not.toHaveBeenCalled();
  });

  it("comes back with a quiet notice when the db refuses", async () => {
    vi.mocked(startPartySeatCheckout).mockResolvedValue({ ok: false, reason: "invalid" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=seat-pay#party-seats`);
  });
});
