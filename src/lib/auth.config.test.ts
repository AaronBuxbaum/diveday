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

  it("keeps the staff operations board gated, even though it sits under the public schedule", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/board")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/board/")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/board/anything")).toBe(false);
  });

  // Pins RESERVED_SCHEDULE_SEGMENTS to exact-match membership rather than a
  // prefix/substring check — a security-reviewer pass on the schedule-route
  // split flagged that without this, a future edit widening the match
  // wouldn't be caught by the test above alone. Real trip ids are
  // server-generated UUIDs (schema.ts), so they can never collide with the
  // literal string "board" in production; these cases only guard the regex
  // itself, not a reachable real-world trip id.
  it("only treats the exact literal 'board' segment as the reserved staff route", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/boarding")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/board-extra")).toBe(true);
    // Uppercase never matches the lowercase-only trip-id pattern at all, so
    // this fails closed (staff-gated) rather than open — not exploitable,
    // but pinned so the behavior is explicit rather than incidental.
    expect(isPublicShopRoute("/shop/blue-mantis/schedule/Board")).toBe(false);
  });

  it("opens the course catalog index and certification paths to a signed-out diver", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/courses")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/paths")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/paths/")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/paths/open-water-to-rescue")).toBe(true);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/paths/open-water-to-rescue/")).toBe(true);
  });

  it("keeps the course editor and creation routes gated", () => {
    expect(isPublicShopRoute("/shop/blue-mantis/courses/open-water-diver/edit")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/new")).toBe(false);
    expect(isPublicShopRoute("/shop/blue-mantis/courses/new/")).toBe(false);
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
    expect(isEmbeddableShopRoute("/shop/blue-mantis/schedule/boarding")).toBe(true);
    expect(isEmbeddableShopRoute("/shop/blue-mantis/schedule/board-extra")).toBe(true);
  });

  it("refuses everything else, including other public routes", () => {
    for (const path of [
      "/shop/blue-mantis",
      "/shop/blue-mantis/courses",
      "/shop/blue-mantis/courses/open-water-diver",
      "/shop/blue-mantis/courses/paths",
      "/shop/blue-mantis/courses/paths/open-water-to-rescue",
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/trips/abc-123",
      "/shop/blue-mantis/schedule/board",
      "/shop/blue-mantis/schedule/board/anything",
      "/shop/blue-mantis/schedule/Board",
      "/sign-in",
    ]) {
      expect(isEmbeddableShopRoute(path)).toBe(false);
    }
  });
});
