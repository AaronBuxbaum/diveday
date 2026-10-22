import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Ask to move to …" from a called-off departure's card (UX sheet 2026-10-22,
 * item 5). The link opens only `strandedContextFor`; the offer is computed
 * again for the link's own booking and shop, and the posted trip id is only
 * compared against it, so a forged or stale one files nothing.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/bookings", () => ({ addPartySeat: vi.fn(), selfCancelBooking: vi.fn() }));
vi.mock("@/db/inbound-messages", () => ({ recordMoveAsk: vi.fn() }));
vi.mock("@/db/move-ask-alerts", () => ({ alertStaffToMoveAsk: vi.fn() }));
vi.mock("@/db/move-offer", () => ({ strandedMoveAsk: vi.fn() }));
vi.mock("@/db/shops", () => ({ getShopById: vi.fn() }));
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
  return { ...actual, contextFor: vi.fn(), strandedContextFor: vi.fn() };
});

const { recordMoveAsk } = await import("@/db/inbound-messages");
const { alertStaffToMoveAsk } = await import("@/db/move-ask-alerts");
const { strandedMoveAsk } = await import("@/db/move-offer");
const { getShopById } = await import("@/db/shops");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { contextFor, strandedContextFor } = await import("./action-helpers");
const { askToMoveFromCancelledAction } = await import("./booking-actions");

const TOKEN = "stranded-token";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";
const OFFERED = "7b1d2e3f-aaaa-4bbb-8ccc-dddddddddddd";
const STARTS_AT = new Date("2026-10-29T16:00:00Z");

async function redirectedTo(tripId: string = OFFERED): Promise<string> {
  const form = new FormData();
  form.set("tripId", tripId);
  // A posted booking id is ignored: the link names the booking.
  form.set("bookingId", "11111111-1111-4111-8111-111111111111");
  try {
    await askToMoveFromCancelledAction(TOKEN, form);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(strandedContextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: BOOKING_ID,
    shopId: "shop-1",
  });
  vi.mocked(strandedMoveAsk).mockResolvedValue({
    state: "open",
    offer: { tripId: OFFERED, title: "Two-Tank Reef", startsAt: STARTS_AT },
  });
  vi.mocked(getShopById).mockResolvedValue({
    id: "shop-1",
    defaultLocale: "es-ES",
    timezone: "America/New_York",
  } as never);
  vi.mocked(recordMoveAsk).mockResolvedValue({ status: "recorded", id: "m1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("askToMoveFromCancelledAction", () => {
  it("files the link's own seat, naming the offered boat in the shop's language", async () => {
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?saved=move-ask#move-ask`);
    expect(strandedMoveAsk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ shopId: "shop-1", bookingId: BOOKING_ID }),
    );
    expect(recordMoveAsk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        shopId: "shop-1",
        bookingId: BOOKING_ID,
        calledOff: true,
        note: expect.stringMatching(/^Por favor, cámbienme a Two-Tank Reef, jue.*29.*oct/),
      }),
    );
    expect(alertStaffToMoveAsk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ shopId: "shop-1", messageId: "m1" }),
    );
    // The ordinary door stays shut to this link.
    expect(contextFor).not.toHaveBeenCalled();
  });

  it("rejects a forged trip id: the boat must be the one the server offers now", async () => {
    await expect(redirectedTo("99999999-9999-4999-8999-999999999999")).resolves.toBe(
      `/ready/${TOKEN}?error=move-ask#move-ask`,
    );
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("files nothing once the offer is gone", async () => {
    vi.mocked(strandedMoveAsk).mockResolvedValue(null);
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=move-ask#move-ask`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("files nothing twice", async () => {
    vi.mocked(strandedMoveAsk).mockResolvedValue({ state: "asked" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}#move-ask`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("says nothing was sent when an ask already stood", async () => {
    vi.mocked(recordMoveAsk).mockResolvedValue({ status: "already" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}#move-ask`);
    expect(alertStaffToMoveAsk).not.toHaveBeenCalled();
  });

  it("refuses a link the stranded check does not open, before reading the offer", async () => {
    vi.mocked(strandedContextFor).mockResolvedValue({ ok: false, reason: "invalid" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}`);
    expect(strandedMoveAsk).not.toHaveBeenCalled();
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("is throttled per address", async () => {
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=rate#move-ask`);
    expect(strandedContextFor).not.toHaveBeenCalled();
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });
});
