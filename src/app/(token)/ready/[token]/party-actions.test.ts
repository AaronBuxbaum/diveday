import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * "Sign Mia's waiver" from the lead's readiness link (H-20261014-parent-signs-minor-release). The posted seat
 * id only says which seat; the seat-claims writer decides whether this lead
 * may open it. A held lead is refused before anything is read off the form.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/seat-claims", () => ({ openMinorSeatWaiver: vi.fn() }));
const jar = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("./action-helpers", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./action-helpers")>();
  return { ...actual, contextFor: vi.fn() };
});

const { openMinorSeatWaiver } = await import("@/db/seat-claims");
const { contextFor } = await import("./action-helpers");
const { signMinorWaiverAction } = await import("./party-actions");

const TOKEN = "ready-token";
const LEAD = "0f2a9c1e-1111-4222-8333-444444444444";
const SEAT = "1f2a9c1e-1111-4222-8333-444444444444";

async function redirectedTo(seat: string = SEAT): Promise<string> {
  const form = new FormData();
  form.set("bookingId", seat);
  try {
    await signMinorWaiverAction(TOKEN, form);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

function withLead(identityHeld = false) {
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: LEAD,
    ownLocale: null,
    delivered: true,
    data: { identityHeld, shop: { id: "shop-1" } } as never,
  });
}

beforeEach(() => {
  withLead();
  vi.mocked(openMinorSeatWaiver).mockResolvedValue({ ok: true, token: "waiver-token" });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe("signMinorWaiverAction", () => {
  it("opens the seat's release, with this link's booking as the lead", async () => {
    await expect(redirectedTo()).resolves.toBe("/waivers/waiver-token");
    expect(openMinorSeatWaiver).toHaveBeenCalledWith(
      {},
      { shopId: "shop-1", leadBookingId: LEAD, seatBookingId: SEAT },
    );
  });

  // Dive-domain review F6 of layer r4-1: the release knows where to send the
  // parent back to, by a cookie on its own path only, never in the URL.
  it("hands the release this link to return to, on that release's path only", async () => {
    await redirectedTo();
    expect(jar.set).toHaveBeenCalledWith(
      "diveday_party_return",
      TOKEN,
      expect.objectContaining({
        path: "/waivers/waiver-token",
        httpOnly: true,
        sameSite: "lax",
        secure: false,
      }),
    );
  });

  it("hands nothing over when the seat cannot be opened", async () => {
    vi.mocked(openMinorSeatWaiver).mockResolvedValue({ ok: false });
    await redirectedTo();
    expect(jar.set).not.toHaveBeenCalled();
  });

  it("says one thing when the seat cannot be opened", async () => {
    vi.mocked(openMinorSeatWaiver).mockResolvedValue({ ok: false });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=minor-waiver#party-seats`);
  });

  it("refuses a seat id that is not one before reading anything", async () => {
    await expect(redirectedTo("not-a-uuid")).resolves.toBe(
      `/ready/${TOKEN}?error=minor-waiver#party-seats`,
    );
    expect(openMinorSeatWaiver).not.toHaveBeenCalled();
  });

  it("refuses a held lead", async () => {
    withLead(true);
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}`);
    expect(openMinorSeatWaiver).not.toHaveBeenCalled();
  });

  it("passes a dead link's answer through", async () => {
    vi.mocked(contextFor).mockResolvedValue({ ok: false, reason: "rate_limited" });
    await expect(redirectedTo()).resolves.toBe(`/ready/${TOKEN}?error=rate`);
    expect(openMinorSeatWaiver).not.toHaveBeenCalled();
  });
});
