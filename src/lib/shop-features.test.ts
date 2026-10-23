import { describe, expect, it } from "vitest";
import { parseShopFeature, SHOP_FEATURE_COLUMNS, SHOP_FEATURES, shopOffers } from "./shop-features";

const allOn = {
  reviewsEnabled: true,
  dateRequestsEnabled: true,
  lastMinuteListEnabled: true,
  tipsEnabled: true,
  publicYearEnabled: true,
  padiChecksEnabled: true,
  claudeSuggestionsEnabled: true,
  recapAssistAutoApprove: true,
};

describe("shopOffers", () => {
  it("reads each feature from its own column", () => {
    for (const feature of SHOP_FEATURES) expect(shopOffers(allOn, feature)).toBe(true);
    const noTips = { ...allOn, tipsEnabled: false };
    expect(shopOffers(noTips, "tips")).toBe(false);
    expect(shopOffers(noTips, "reviews")).toBe(true);
  });
});

describe("parseShopFeature", () => {
  it("accepts only a known feature", () => {
    expect(parseShopFeature("reviews")).toBe("reviews");
    expect(parseShopFeature("padiChecks")).toBe("padiChecks");
    expect(parseShopFeature("crewSchedule")).toBeNull();
    expect(parseShopFeature("tipsEnabled")).toBeNull();
    expect(parseShopFeature(null)).toBeNull();
  });
});

describe("a new shop", () => {
  it("starts with every feature on, and the crew schedule too (Aaron, 2026-10-23)", async () => {
    const { shops } = await import("@/db/schema");
    for (const feature of SHOP_FEATURES) {
      expect(shops[SHOP_FEATURE_COLUMNS[feature]].default, feature).toBe(true);
    }
    expect(shops.crewScheduleEnabled.default).toBe(true);
  });

  it("keeps Stripe Tax off until the shop's owner decides otherwise", async () => {
    const { shops } = await import("@/db/schema");
    expect(shops.taxEnabled.default).toBe(false);
  });

  it("knows the assist switches by name", () => {
    expect(parseShopFeature("claudeSuggestions")).toBe("claudeSuggestions");
    expect(parseShopFeature("recapAutoApprove")).toBe("recapAutoApprove");
  });
});
