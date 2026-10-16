import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";

/**
 * The server's half of the Your days gate (security review of layer r5-4,
 * F1): a hand-made post from the link a booking or a seat claim redirected to
 * plans and sends nothing, whatever booking it names.
 */

const planYourDayLink = vi.fn();
const sendYourDayLink = vi.fn();
vi.mock("@/db/your-days", () => ({ planYourDayLink, sendYourDayLink }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
const contextFor = vi.fn();
vi.mock("./action-helpers", () => ({ contextFor }));

const { checkRateLimit, rateLimitKey } = await import("@/lib/rate-limit");
const { sendYourDayLinkAction } = await import("./your-days-actions");

const TARGET = "00000000-0000-4000-8000-0000000000aa";

function post() {
  const form = new FormData();
  form.set("bookingId", TARGET);
  return sendYourDayLinkAction("token", { bookingId: null, outcome: null }, form);
}

afterEach(() => vi.clearAllMocks());

describe("sendYourDayLinkAction", () => {
  it("refuses an undelivered link before planning anything", async () => {
    contextFor.mockResolvedValueOnce({
      ok: true,
      db: {},
      bookingId: "00000000-0000-4000-8000-000000000001",
      data: { identityHeld: false, shop: { id: "shop" } } as unknown as ReadyPageData,
      ownLocale: null,
      delivered: false,
    });

    expect(await post()).toEqual({ bookingId: TARGET, outcome: "unavailable" });
    expect(planYourDayLink).not.toHaveBeenCalled();
    expect(sendYourDayLink).not.toHaveBeenCalled();
  });

  it("spends a budget per person, so a regular's many rows cannot flood one inbox", async () => {
    contextFor.mockResolvedValueOnce({
      ok: true,
      db: {},
      bookingId: "00000000-0000-4000-8000-000000000001",
      data: {
        identityHeld: false,
        shop: { id: "shop" },
        person: { id: "person-1" },
      } as unknown as ReadyPageData,
      ownLocale: null,
      delivered: true,
    });
    planYourDayLink.mockResolvedValueOnce({ ok: true, bookingId: TARGET });
    vi.mocked(checkRateLimit)
      .mockResolvedValueOnce({ allowed: true, retryAfterMs: 0 })
      .mockResolvedValueOnce({ allowed: false, retryAfterMs: 1_000 });

    expect(await post()).toEqual({ bookingId: TARGET, outcome: "rate_limited" });
    expect(vi.mocked(checkRateLimit).mock.calls[1]?.[0]).toBe(
      rateLimitKey("your-day-link", "person", "person-1"),
    );
    expect(sendYourDayLink).not.toHaveBeenCalled();
  });
});
