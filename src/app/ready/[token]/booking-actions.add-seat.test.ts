import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Add a seat" from the shared readiness link (security review of layer 8,
 * D3): besides the per-IP booking bucket, the seats one booking adds spend
 * from a bucket keyed by **that booking**, so one link cannot be sprayed from
 * many addresses to fill a boat. The page-data half (a lead the page could
 * charge pays first) is pinned in `src/db/ready.test.ts`.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/bookings", () => ({ addPartySeat: vi.fn(), selfCancelBooking: vi.fn() }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/analytics", () => ({ trackEvent: vi.fn() }));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, target: string) => {
    throw new Error(`REDIRECT:${target}`);
  }),
}));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("./action-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-helpers")>();
  return { ...actual, contextFor: vi.fn() };
});

const { addPartySeat } = await import("@/db/bookings");
const { checkRateLimit, RATE_LIMITS, rateLimitKey } = await import("@/lib/rate-limit");
const { contextFor } = await import("./action-helpers");
const { addSeatFromReady } = await import("./booking-actions");

const TOKEN = "ready-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

function form(seatName: string): FormData {
  const data = new FormData();
  data.set("seatName", seatName);
  return data;
}

async function redirectedTo(): Promise<string> {
  try {
    await addSeatFromReady(TOKEN, form("Milo Reyes"));
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: BOOKING_ID,
    ownLocale: null,
    delivered: true,
    data: { canAddSeat: true, identityHeld: false, shop: { id: "shop-1" } } as never,
  });
  vi.mocked(addPartySeat).mockResolvedValue({ ok: true } as never);
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("addSeatFromReady", () => {
  it("spends a per-booking bucket before adding the seat", async () => {
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?saved=seat#party-seats`);
    expect(checkRateLimit).toHaveBeenCalledWith(
      rateLimitKey("ready-add-seat", "booking", BOOKING_ID),
      RATE_LIMITS.readyAddSeatByBooking,
    );
  });

  it("adds nothing once that booking's bucket is empty", async () => {
    const bookingKey = rateLimitKey("ready-add-seat", "booking", BOOKING_ID);
    vi.mocked(checkRateLimit).mockImplementation(async (key) =>
      key === bookingKey
        ? { allowed: false, retryAfterMs: 1000 }
        : { allowed: true, retryAfterMs: 0 },
    );
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=rate`);
    expect(addPartySeat).not.toHaveBeenCalled();
  });
});
