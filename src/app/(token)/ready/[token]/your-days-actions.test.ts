import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "../../../../features/ready/store";

/**
 * The server's half of the Your days gate (security review of layer r5-4,
 * F1): a hand-made post from the link a booking or a seat claim redirected to
 * opens nothing, whatever booking it names. A delivered link opens the day
 * directly (#4059).
 */

const openYourDay = vi.fn();
vi.mock("../../../../features/your-days/store", () => ({ openYourDay }));
vi.mock("next/navigation", () => ({
  redirect: (to: string) => {
    throw new Error(`REDIRECT:${to}`);
  },
}));
const contextFor = vi.fn();
vi.mock("./action-helpers", () => ({ contextFor }));

const { openYourDayAction } = await import("./your-days-actions");

const TARGET = "00000000-0000-4000-8000-0000000000aa";

function context(delivered: boolean) {
  return {
    ok: true,
    db: {},
    bookingId: "00000000-0000-4000-8000-000000000001",
    data: { identityHeld: false, shop: { id: "shop" } } as unknown as ReadyPageData,
    ownLocale: null,
    delivered,
  };
}

async function post() {
  const form = new FormData();
  form.set("bookingId", TARGET);
  try {
    return await openYourDayAction("token", { bookingId: null, outcome: null }, form);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
}

afterEach(() => vi.clearAllMocks());

describe("openYourDayAction", () => {
  it("refuses an undelivered link before reading anything", async () => {
    contextFor.mockResolvedValueOnce(context(false));
    expect(await post()).toEqual({ bookingId: TARGET, outcome: "unavailable" });
    expect(openYourDay).not.toHaveBeenCalled();
  });

  it("opens the day from a delivered link", async () => {
    contextFor.mockResolvedValueOnce(context(true));
    openYourDay.mockResolvedValueOnce("/ready/other-day");
    expect(await post()).toBe("/ready/other-day");
    expect(openYourDay.mock.calls[0]?.[1]).toMatchObject({
      shopId: "shop",
      fromBookingId: "00000000-0000-4000-8000-000000000001",
      targetBookingId: TARGET,
    });
  });

  it("says the day is gone when it is no longer on the list", async () => {
    contextFor.mockResolvedValueOnce(context(true));
    openYourDay.mockResolvedValueOnce(null);
    expect(await post()).toEqual({ bookingId: TARGET, outcome: "unavailable" });
  });
});
