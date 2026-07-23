import { describe, expect, it } from "vitest";
import { isPublicShopRoute } from "./auth.config";

/**
 * This matcher is the whole boundary between a shop's marketing pages and its
 * operations. A false positive hands a signed-out visitor a staff screen, so
 * the gated cases matter more than the public ones.
 */
describe("isPublicShopRoute", () => {
  it("lets a diver read the schedule and a course page", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/schedule")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/abc-123")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/open-water-diver")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/open-water-diver/")).toBe(true);
  });

  it("keeps the staff course catalog and editor gated", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/courses")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/open-water-diver/edit")).toBe(false);
  });

  it("refuses the staff segments a course slug could otherwise impersonate", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/courses/catalog")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/new")).toBe(false);
  });

  it("keeps the rest of the shop gated", () => {
    for (const path of [
      "/shop/blue-mantis",
      "/shop/blue-mantis/divers",
      "/shop/blue-mantis/trips/abc-123",
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/waivers",
    ]) {
      expect(isPublicShopRoute(path)).toBe(false);
    }
  });
});
