import { describe, expect, it } from "vitest";
import {
  MAX_PASSWORD_LENGTH,
  MAX_SHOP_SLUG_LENGTH,
  MIN_PASSWORD_LENGTH,
  onboardSchema,
  suggestShopSlug,
} from "./onboarding";
import { publicSchedulePath, shopSlugFromPublicPath } from "./public-routes";

const validInput = {
  shopName: "Green Lagoon Divers",
  shopSlug: "green-lagoon",
  timezone: "America/New_York",
  ownerName: "Nora Quinn",
  ownerEmail: "nora@example.com",
  ownerPassword: "correct horse",
};

describe("onboardSchema (CR-014)", () => {
  it("accepts a well-formed submission", () => {
    expect(onboardSchema.safeParse(validInput).success).toBe(true);
  });

  it("sells no slug the routes cannot read back", () => {
    // These two rules were written twice and drifted: the schema sold
    // `blue--mantis` while `SHOP_SLUG_PATTERN` refused it, so every reader of
    // a proxy-stamped slug dropped that shop's name — and a dead link under it
    // was answered by DiveDay's sales 404 with a trial button instead of the
    // shop's own (issue #765). One pattern now; this holds the ends together.
    for (const shopSlug of ["blue--mantis", "-reef", "reef-", "a", "2024-reef"]) {
      expect(onboardSchema.safeParse({ ...validInput, shopSlug }).success).toBe(true);
      expect(shopSlugFromPublicPath(publicSchedulePath(shopSlug))).toBe(shopSlug);
    }
  });

  it("rejects a well-formed but nonexistent timezone", () => {
    const result = onboardSchema.safeParse({ ...validInput, timezone: "Etc/Nowhere" });
    expect(result.success).toBe(false);
  });

  it("rejects a non-timezone string", () => {
    const result = onboardSchema.safeParse({ ...validInput, timezone: "not a timezone" });
    expect(result.success).toBe(false);
  });

  it("rejects a password shorter than the minimum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MIN_PASSWORD_LENGTH - 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a password at exactly the minimum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MIN_PASSWORD_LENGTH),
    });
    expect(result.success).toBe(true);
  });

  it("rejects a password longer than the maximum, so bcrypt never silently truncates it", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MAX_PASSWORD_LENGTH + 1),
    });
    expect(result.success).toBe(false);
  });

  it("accepts a password at exactly the maximum", () => {
    const result = onboardSchema.safeParse({
      ...validInput,
      ownerPassword: "x".repeat(MAX_PASSWORD_LENGTH),
    });
    expect(result.success).toBe(true);
  });
});

describe("suggestShopSlug", () => {
  it("turns a shop name into its implied link", () => {
    expect(suggestShopSlug("Green Lagoon Divers")).toBe("green-lagoon-divers");
  });

  it("folds diacritics to their base letters instead of dropping them", () => {
    expect(suggestShopSlug("Café Buceo Cozumel")).toBe("cafe-buceo-cozumel");
  });

  it("collapses punctuation runs into a single hyphen with no leading or trailing dash", () => {
    expect(suggestShopSlug("  Reef & Wreck — Dive Co.  ")).toBe("reef-wreck-dive-co");
  });

  it("returns empty for a name with no usable characters, meaning no suggestion", () => {
    expect(suggestShopSlug("日本ダイビング")).toBe("");
  });

  it("always satisfies the schema's own slug rule at any length", () => {
    const long = suggestShopSlug(`The ${"Very ".repeat(30)}Long Dive Shop Name`);
    expect(long.length).toBeLessThanOrEqual(MAX_SHOP_SLUG_LENGTH);
    expect(onboardSchema.safeParse({ ...validInput, shopSlug: long }).success).toBe(true);
    // A truncation that lands on a word boundary must not leave a trailing dash.
    expect(long.endsWith("-")).toBe(false);
  });
});
