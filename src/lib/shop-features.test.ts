import { describe, expect, it } from "vitest";
import { parseShopFeature, SHOP_FEATURES, shopOffers } from "./shop-features";

const allOn = {
  reviewsEnabled: true,
  dateRequestsEnabled: true,
  lastMinuteListEnabled: true,
  tipsEnabled: true,
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
    expect(parseShopFeature("crewSchedule")).toBeNull();
    expect(parseShopFeature("tipsEnabled")).toBeNull();
    expect(parseShopFeature(null)).toBeNull();
  });
});
