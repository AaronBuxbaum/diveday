import { describe, expect, it } from "vitest";
import { parseShopFeature, SHOP_FEATURES, shopOffers } from "./shop-features";

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

describe("PADI checks", () => {
  it("wait for the shop's own yes, like Our year", async () => {
    const { shops } = await import("@/db/schema");
    expect(shops.padiChecksEnabled.default).toBe(false);
    expect(shops.publicYearEnabled.default).toBe(false);
  });
});

describe("Claude suggestions", () => {
  it("start on: every assist is a draft a person still accepts", async () => {
    const { shops } = await import("@/db/schema");
    expect(shops.claudeSuggestionsEnabled.default).toBe(true);
    expect(parseShopFeature("claudeSuggestions")).toBe("claudeSuggestions");
  });

  it("recap highlights start off: the crew approves each one until the shop says otherwise", async () => {
    const { shops } = await import("@/db/schema");
    expect(shops.recapAssistAutoApprove.default).toBe(false);
    expect(parseShopFeature("recapAutoApprove")).toBe("recapAutoApprove");
  });
});
