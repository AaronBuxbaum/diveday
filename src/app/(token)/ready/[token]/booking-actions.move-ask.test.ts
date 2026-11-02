import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Ask to move" from the readiness link (H-20261014-ask-to-move). The page's own read decides,
 * never the form: only an `open` ask is filed, a held seat is refused before
 * anything is read off the form, and the booking filed is the link's own.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/bookings", () => ({ addPartySeat: vi.fn(), selfCancelBooking: vi.fn() }));
vi.mock("@/db/inbound-messages", () => ({ recordMoveAsk: vi.fn() }));
vi.mock("@/db/move-ask-alerts", () => ({ alertStaffToMoveAsk: vi.fn() }));
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

const { recordMoveAsk } = await import("@/db/inbound-messages");
const { alertStaffToMoveAsk } = await import("@/db/move-ask-alerts");
const { checkRateLimit } = await import("@/lib/rate-limit");
const { contextFor } = await import("./action-helpers");
const { askToMoveAction } = await import("./booking-actions");

const TOKEN = "ready-token";
const TRIP_ID = "0f2a9c1e-2222-4222-8333-444444444444";
const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

function withPage(data: Record<string, unknown>) {
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: BOOKING_ID,
    ownLocale: null,
    delivered: true,
    data: { identityHeld: false, shop: { id: "shop-1" }, trip: { id: TRIP_ID }, ...data } as never,
  });
}

async function redirectedTo(note = "Any Saturday", tripId = TRIP_ID): Promise<string> {
  const form = new FormData();
  form.set("note", note);
  form.set("tripId", tripId);
  // A posted booking id is ignored: the link names the booking.
  form.set("bookingId", "11111111-1111-4111-8111-111111111111");
  try {
    await askToMoveAction(TOKEN, form);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(checkRateLimit).mockResolvedValue({ allowed: true, retryAfterMs: 0 });
  vi.mocked(recordMoveAsk).mockResolvedValue({ status: "recorded", id: "m1" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("askToMoveAction", () => {
  it("files the link's own booking with the diver's note", async () => {
    withPage({ moveAsk: "open" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?saved=move-ask#move-ask`);
    expect(recordMoveAsk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({
        shopId: "shop-1",
        bookingId: BOOKING_ID,
        expectedTripId: TRIP_ID,
        note: "Any Saturday",
      }),
    );
    // #2667: the filed ask is what may email owners and managers.
    expect(alertStaffToMoveAsk).toHaveBeenCalledWith(
      {},
      expect.objectContaining({ shopId: "shop-1", messageId: "m1" }),
    );
  });

  it("files nothing for a seat the page offers no ask on", async () => {
    withPage({ moveAsk: null });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=move-ask`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("files nothing twice: an asked seat lands on the asked state, not on Sent", async () => {
    withPage({ moveAsk: { note: "Any Saturday", sentAt: new Date("2026-07-21T13:30:00Z") } });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}#move-ask`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  // Dive-domain review F1 of layer r4-1: nothing new recorded is not "Sent".
  it("says nothing was sent when an ask already stood", async () => {
    withPage({ moveAsk: "open" });
    vi.mocked(recordMoveAsk).mockResolvedValue({ status: "already" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}#move-ask`);
    // Nothing new filed, nobody emailed again.
    expect(alertStaffToMoveAsk).not.toHaveBeenCalled();
  });

  it("refuses a held seat before anything else", async () => {
    withPage({ moveAsk: "open", identityHeld: true });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("refuses a form displayed for a different departure than the validated booking", async () => {
    withPage({ moveAsk: "open" });
    await expect(redirectedTo("Old date", "0f2a9c1e-3333-4222-8333-444444444444")).resolves.toBe(
      `/ready/${TOKEN}?error=move-ask`,
    );
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });

  it("does not acknowledge or alert when a concurrent move invalidates the write", async () => {
    withPage({ moveAsk: "open" });
    vi.mocked(recordMoveAsk).mockResolvedValue({ status: "not_found" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=move-ask`);
    expect(alertStaffToMoveAsk).not.toHaveBeenCalled();
  });

  it("keeps a bounded lock refusal inline without claiming the request was sent", async () => {
    withPage({ moveAsk: "open" });
    vi.mocked(recordMoveAsk).mockRejectedValue(new Error("busy", { cause: { code: "55P03" } }));
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=move-ask`);
    expect(alertStaffToMoveAsk).not.toHaveBeenCalled();
  });

  it("reveals nothing and files nothing for an expired or revoked capability", async () => {
    vi.mocked(contextFor).mockResolvedValue({ ok: false, reason: "invalid" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
    expect(alertStaffToMoveAsk).not.toHaveBeenCalled();
  });

  it("is throttled per address", async () => {
    withPage({ moveAsk: "open" });
    vi.mocked(checkRateLimit).mockResolvedValue({ allowed: false, retryAfterMs: 1000 });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=rate`);
    expect(recordMoveAsk).not.toHaveBeenCalled();
  });
});
