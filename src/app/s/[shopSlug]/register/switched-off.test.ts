import { describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * **Counter sign-up switched off on Features** (ADR
 * 20261005-optional-shop-features): the public register page is a 404, as if
 * the shop never offered it, and a hand-built post puts nobody on file and
 * reads no card photo.
 */

const OFF_SHOP = {
  id: "shop-off",
  slug: "no-counter",
  name: "No Counter Divers",
  defaultLocale: "en-US",
  timezone: "America/New_York",
  selfRegistrationEnabled: false,
};

vi.mock("@/db/client", () => ({ getDb: vi.fn(async () => ({})) }));
vi.mock("@/db/shops-cached", () => ({ shopBySlugCached: vi.fn(async () => OFF_SHOP) }));
vi.mock("@/db/shops", () => ({ getShopBySlug: vi.fn(async () => OFF_SHOP) }));
vi.mock("@/db/self-registration", () => ({
  registerDiverAtShop: vi.fn(),
  deliverSelfRegistrationWaiver: vi.fn(),
}));
vi.mock("@/db/assists", () => ({ assistsAvailable: vi.fn(async () => true), runAssist: vi.fn() }));
vi.mock("@/i18n/request", () => ({
  requestLocale: vi.fn(async () => "en-US"),
  requestTranslator: vi.fn(async () => ({ locale: "en-US", t: diverTranslator("en-US") })),
}));
vi.mock("@/lib/request-ip", () => ({ clientIp: vi.fn(async () => "203.0.113.9") }));
vi.mock("@/lib/rate-limit", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/rate-limit")>();
  return {
    ...actual,
    checkRateLimit: vi.fn(async () => ({ allowed: true })),
    checkRateLimitFailClosed: vi.fn(async () => ({ allowed: true })),
  };
});

const { registerDiverAtShop } = await import("@/db/self-registration");
const { runAssist } = await import("@/db/assists");
const { shopBySlugCached } = await import("@/db/shops-cached");
const { default: RegisterPage } = await import("./page");
const { registerAtShopAction } = await import("./actions");
const { readCardPhotoAtShopAction } = await import("./card-photo-action");

describe("the counter sign-up with the switch off", () => {
  it("is a 404", async () => {
    await expect(
      RegisterPage({ params: Promise.resolve({ shopSlug: "no-counter" }) }),
    ).rejects.toThrow(/NEXT_HTTP_ERROR_FALLBACK;404/);
  });

  it("puts nobody on file from a hand-built post", async () => {
    const form = new FormData();
    form.set("fullName", "Walk In");
    form.set("email", "walk.in@example.com");
    const outcome = await registerAtShopAction("no-counter", {}, form);
    expect(outcome).toEqual({ error: diverTranslator("en-US")("register.unavailable") });
    expect(registerDiverAtShop).not.toHaveBeenCalled();
  });

  it("reads no card photo", async () => {
    const image = { data: "/9j/4AAQSkZJRg==", mediaType: "image/jpeg" };
    expect(await readCardPhotoAtShopAction("no-counter", image)).toBeNull();
    // It got as far as asking about the shop, and stopped there.
    expect(shopBySlugCached).toHaveBeenCalledWith("no-counter");
    expect(runAssist).not.toHaveBeenCalled();
  });
});
