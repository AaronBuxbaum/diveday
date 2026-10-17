import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ReadyPageData } from "@/db/ready";

/**
 * **Sharing a photo with the boat goes through the diver's own readiness
 * link** (security review of layer r5-4, F3). The verified readiness token
 * names the booking; a held seat shares nothing; the photo lands on the same
 * recap the `/recap` upload writes to, with the tick honored only here.
 */

vi.mock("next/navigation", () => ({
  redirect: vi.fn((path: string) => {
    throw new Error(`REDIRECT:${path}`);
  }),
}));
vi.mock("@/lib/navigation", () => ({
  revalidateAndRedirect: vi.fn((_path: string, to: string) => {
    throw new Error(`REDIRECT:${to}`);
  }),
}));
vi.mock("@/db/people", () => ({ recordDiverOwnLocaleForBooking: vi.fn() }));
vi.mock("@/db/recap", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/db/recap")>();
  return {
    ...actual,
    isRecapOpen: vi.fn(async () => true),
    canAddRecapPhoto: vi.fn(async () => ({ ok: true })),
    addRecapPhoto: vi.fn(async () => ({ ok: true, photo: { id: "photo" } })),
  };
});
vi.mock("@/lib/storage", () => ({
  storeRecapImage: vi.fn(async () => ({ status: "stored", url: "https://img/reef.jpg" })),
  deleteStoredImage: vi.fn(),
}));
vi.mock("@/i18n/request", () => ({ requestFirstHandLocale: vi.fn(async () => "en-US") }));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.7") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return { ...actual, checkRateLimit: vi.fn(async () => ({ allowed: true, retryAfterMs: 0 })) };
});
vi.mock("@/lib/recap-links", () => ({
  signRecapToken: vi.fn((bookingId: string) => `recap-for-${bookingId}`),
  verifyRecapToken: vi.fn((token: string) => token.replace(/^recap-for-/, "")),
}));
const contextFor = vi.fn();
vi.mock("./action-helpers", () => ({
  contextFor,
  bounceTarget: (token: string, reason: string) =>
    reason === "rate_limited" ? `/ready/${token}?error=rate` : `/ready/${token}`,
}));

const { addRecapPhoto } = await import("@/db/recap");
const { storeRecapImage } = await import("@/lib/storage");
const { uploadRecapPhotoFromReadyAction } = await import("./recap-photo-actions");

const BOOKING_ID = "0f2a9c1e-1111-4222-8333-444444444444";

function context(identityHeld: boolean, delivered = true) {
  return {
    ok: true,
    db: {},
    bookingId: BOOKING_ID,
    data: { identityHeld } as unknown as ReadyPageData,
    ownLocale: null,
    delivered,
  };
}

function photoForm(share: boolean): FormData {
  const data = new FormData();
  data.append("photo", new File(["x"], "reef.jpg", { type: "image/jpeg" }));
  if (share) data.append("shareWithBoat", "on");
  return data;
}

async function landing(data: FormData): Promise<string> {
  try {
    await uploadRecapPhotoFromReadyAction("readiness-token", data);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("REDIRECT:")) return message.slice("REDIRECT:".length);
    throw error;
  }
  throw new Error("action returned without redirecting");
}

beforeEach(() => contextFor.mockResolvedValue(context(false)));
afterEach(() => vi.clearAllMocks());

describe("uploadRecapPhotoFromReadyAction", () => {
  it("shares the photo with the boat when the diver ticked it", async () => {
    expect(await landing(photoForm(true))).toBe(`/recap/recap-for-${BOOKING_ID}?photo=added`);
    expect(vi.mocked(addRecapPhoto).mock.calls[0]?.[1]).toMatchObject({
      bookingId: BOOKING_ID,
      shareWithBoat: true,
    });
  });

  it("keeps it on this recap alone when the box is left empty", async () => {
    await landing(photoForm(false));
    expect(vi.mocked(addRecapPhoto).mock.calls[0]?.[1]).toMatchObject({ shareWithBoat: false });
  });

  it("keeps the photo on this recap alone from an undelivered link, ticked or not (second pass, N-a)", async () => {
    contextFor.mockResolvedValueOnce(context(false, false));
    expect(await landing(photoForm(true))).toBe(`/recap/recap-for-${BOOKING_ID}?photo=added`);
    expect(vi.mocked(addRecapPhoto).mock.calls[0]?.[1]).toMatchObject({ shareWithBoat: false });
  });

  it("stores nothing for a link that does not verify", async () => {
    contextFor.mockResolvedValueOnce({ ok: false, reason: "invalid" });
    expect(await landing(photoForm(true))).toBe("/ready/readiness-token");
    expect(storeRecapImage).not.toHaveBeenCalled();
  });

  it("stores nothing on a held seat", async () => {
    contextFor.mockResolvedValueOnce(context(true));
    expect(await landing(photoForm(true))).toBe("/ready/readiness-token");
    expect(storeRecapImage).not.toHaveBeenCalled();
  });
});
