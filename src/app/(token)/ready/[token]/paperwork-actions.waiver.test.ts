import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/db/waivers", async (original) => ({
  ...(await original<typeof import("@/db/waivers")>()),
  issueWaiverRequest: vi.fn(),
}));
const jar = { set: vi.fn() };
vi.mock("next/headers", () => ({ cookies: vi.fn(async () => jar) }));
vi.mock("./action-helpers", async (original) => ({
  ...(await original<typeof import("./action-helpers")>()),
  contextFor: vi.fn(),
}));

const { issueWaiverRequest } = await import("@/db/waivers");
const { contextFor } = await import("./action-helpers");
const { signWaiverFromReady } = await import("./paperwork-actions");

async function redirectedTo() {
  try {
    await signWaiverFromReady("ready-token");
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => {
  vi.mocked(contextFor).mockResolvedValue({
    ok: true,
    db: {} as never,
    bookingId: "booking-1",
    ownLocale: null,
    delivered: true,
    data: { identityHeld: false, shop: { id: "shop-1" } } as never,
  });
  vi.mocked(issueWaiverRequest).mockResolvedValue({
    ok: true,
    token: "waiver-token",
    recordId: "record-1",
    reused: false,
    expiresAt: new Date("2030-01-01T00:00:00Z"),
  });
});
afterEach(() => vi.clearAllMocks());

describe("opening a waiver from readiness", () => {
  it("carries the independently held link only on that waiver's path", async () => {
    expect(await redirectedTo()).toBe("/waivers/waiver-token");
    expect(jar.set).toHaveBeenCalledWith(
      "diveday_waiver_return",
      "ready-token",
      expect.objectContaining({
        path: "/waivers/waiver-token",
        httpOnly: true,
        sameSite: "lax",
        maxAge: 3_600,
        secure: false,
      }),
    );
  });
  it("does not set a return link when the waiver cannot be opened", async () => {
    vi.mocked(issueWaiverRequest).mockResolvedValue({ ok: false, reason: "booking_not_found" });
    await redirectedTo();
    expect(jar.set).not.toHaveBeenCalled();
  });
});
