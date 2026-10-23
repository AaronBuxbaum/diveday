import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { diverTranslator } from "@/i18n/messages";

/**
 * **Counter sign-up switched off on Features** (ADR
 * 20261005-optional-shop-features): a printed counter card's QR still lands
 * somewhere, so the register page sends the diver to the crew and draws no
 * form; a hand-built post puts nobody on file and reads no card photo.
 */

const OFF_SHOP = {
  id: "shop-off",
  slug: "no-counter",
  name: "No Counter Divers",
  defaultLocale: "en-US",
  timezone: "America/New_York",
  selfRegistrationEnabled: false,
  contactPhone: "+1 305 555 0142",
  contactEmail: "desk@nocounter.example",
  // Never shown on this page: what the shopfront footer does not show.
  stripeAccountId: "acct_private",
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
  it("sends the diver to the crew, with the shop’s name and contact, and draws no form", async () => {
    const html = renderToStaticMarkup(
      await RegisterPage({ params: Promise.resolve({ shopSlug: "no-counter" }) }),
    );
    expect(html).toContain("No Counter Divers");
    expect(html).toContain(diverTranslator("en-US")("register.switchedOff"));
    expect(html).toContain("+1 305 555 0142");
    expect(html).toContain("desk@nocounter.example");
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<input");
    expect(html).not.toContain("acct_private");
  });

  it("is still a 404 for a shop that does not exist", async () => {
    vi.mocked(shopBySlugCached).mockResolvedValueOnce(null as never);
    await expect(
      RegisterPage({ params: Promise.resolve({ shopSlug: "nobody" }) }),
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
