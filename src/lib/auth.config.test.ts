// The same path-to-regexp build Next compiles `redirects()` sources with
// (next/dist/lib/load-custom-routes) — matching the real matcher rather than a
// hand-rolled approximation is the whole point of this file.
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import { describe, expect, it } from "vitest";
import { isEmbeddableShopRoute } from "./auth.config";
import { LEGACY_PUBLIC_SHOP_REDIRECTS } from "./public-routes";

/**
 * `isPublicShopRoute` is gone: `/shop/**` is staff, without exception, and the
 * diver surfaces it used to hold open live under `/s/<shopSlug>` (ADR
 * 20260803-public-shop-namespace). What used to be an allowlist of holes in the
 * staff namespace is now a redirect table, so these tests pin the table
 * instead — a source pattern that swallowed a staff route would send staff to
 * a diver page (or, worse, 308 a staff URL into a public one).
 */
describe("LEGACY_PUBLIC_SHOP_REDIRECTS", () => {
  const matches = (source: string, pathname: string) =>
    pathToRegexp(source, [], { strict: true, sensitive: false, delimiter: "/" }).test(pathname);

  const [schedule, trip, tripCalendar, course] = LEGACY_PUBLIC_SHOP_REDIRECTS;

  it("redirects the old public schedule to the shop's new public root", () => {
    expect(matches(schedule.source, "/shop/blue-mantis/schedule")).toBe(true);
    expect(schedule.destination).toBe("/s/:shopSlug");
  });

  it("redirects an old trip URL to the new trips segment", () => {
    expect(matches(trip.source, "/shop/blue-mantis/schedule/abc-123")).toBe(true);
    expect(trip.destination).toBe("/s/:shopSlug/trips/:tripId");
    expect(matches(tripCalendar.source, "/shop/blue-mantis/schedule/abc-123/calendar")).toBe(true);
  });

  it("never swallows the staff operations board", () => {
    expect(matches(trip.source, "/shop/blue-mantis/schedule/board")).toBe(false);
    expect(matches(trip.source, "/shop/blue-mantis/schedule/board/anything")).toBe(false);
    // Only the exact literal segment is reserved — a real trip id is a
    // server-generated UUID and can never collide with it, but a slug that
    // merely starts with "board" is still a trip.
    expect(matches(trip.source, "/shop/blue-mantis/schedule/boarding")).toBe(true);
    expect(matches(trip.source, "/shop/blue-mantis/schedule/board-extra")).toBe(true);
  });

  it("redirects a course page but never a staff course route", () => {
    expect(matches(course.source, "/shop/blue-mantis/courses/open-water-diver")).toBe(true);
    expect(course.destination).toBe("/s/:shopSlug/courses/:courseSlug");
    // The catalog roster, the path builder, and the editor all keep serving
    // staff at their own URLs — RESERVED_COURSE_SEGMENTS plus the depth limit.
    expect(matches(course.source, "/shop/blue-mantis/courses")).toBe(false);
    expect(matches(course.source, "/shop/blue-mantis/courses/paths")).toBe(false);
    expect(matches(course.source, "/shop/blue-mantis/courses/paths/open-water-to-rescue")).toBe(
      false,
    );
    expect(matches(course.source, "/shop/blue-mantis/courses/new")).toBe(false);
    expect(matches(course.source, "/shop/blue-mantis/courses/catalog")).toBe(false);
    expect(matches(course.source, "/shop/blue-mantis/courses/open-water-diver/edit")).toBe(false);
  });

  it("leaves every other staff route alone", () => {
    for (const path of [
      "/shop/blue-mantis",
      "/shop/blue-mantis/divers",
      "/shop/blue-mantis/trips/abc-123",
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/waivers",
    ]) {
      for (const rule of LEGACY_PUBLIC_SHOP_REDIRECTS) {
        expect(matches(rule.source, path)).toBe(false);
      }
    }
  });
});

/**
 * The framing allowlist is deliberately narrower than the public namespace —
 * course pages are public but never framed, because only the schedule embed is
 * a supported widget surface (docs ADR 20260726-schedule-embed).
 */
describe("isEmbeddableShopRoute", () => {
  it("allows the schedule and trip pages a shop would embed", () => {
    expect(isEmbeddableShopRoute("/s/blue-mantis")).toBe(true);
    expect(isEmbeddableShopRoute("/s/blue-mantis/")).toBe(true);
    expect(isEmbeddableShopRoute("/s/blue-mantis/trips/abc-123")).toBe(true);
    expect(isEmbeddableShopRoute("/s/blue-mantis/trips/abc-123/")).toBe(true);
  });

  it("refuses everything else, including other public routes", () => {
    for (const path of [
      "/s/blue-mantis/courses",
      "/s/blue-mantis/courses/open-water-diver",
      "/s/blue-mantis/courses/paths",
      "/s/blue-mantis/courses/paths/open-water-to-rescue",
      "/s/blue-mantis/trips",
      "/s/blue-mantis/trips/abc-123/calendar",
      "/shop/blue-mantis",
      "/shop/blue-mantis/schedule",
      "/shop/blue-mantis/schedule/abc-123",
      "/shop/blue-mantis/schedule/board",
      "/shop/blue-mantis/settings",
      "/shop/blue-mantis/trips/abc-123",
      "/sign-in",
    ]) {
      expect(isEmbeddableShopRoute(path)).toBe(false);
    }
  });
});
