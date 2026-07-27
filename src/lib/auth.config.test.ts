import { describe, expect, it } from "vitest";
import { isEmbeddableShopRoute, isPublicShopRoute } from "./auth.config";

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

/**
 * The framing allowlist is deliberately narrower than the public-route
 * allowlist — courses are public but never framed, because only the schedule
 * embed is a supported widget surface (docs ADR 20260726-schedule-embed).
 */
describe("isEmbeddableShopRoute", () => {
  it("allows the schedule and trip pages a shop would embed", () => {
    expect(isEmbeddableShopRoute("/shop/blue-mantis/schedule")).toBe(true);
    expect(isEmbeddableShopRoute("/shop/blue-mantis/schedule/abc-123")).toBe(true);
  });

  it("refuses everything else, including other public routes", () => {
    for (const path of [
      "/shop/blue-mantis",
      "/shop/blue-mantis/courses/open-water-diver",
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/trips/abc-123",
      "/sign-in",
    ]) {
      expect(isEmbeddableShopRoute(path)).toBe(false);
    }
  });
});
