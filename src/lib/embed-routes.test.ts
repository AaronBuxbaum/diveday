import { describe, expect, it } from "vitest";
import {
  EMBED_WIDGETS,
  embedCalendarPath,
  embedTripPath,
  embedWidgetPath,
  isEmbedRoute,
  isUnknownEmbedWidgetRoute,
} from "./embed-routes";

/**
 * **A frame is where the URL is** (issue #2744). The framing allowlist is one
 * path prefix, `/s/<slug>/embed/`, and deliberately narrower than the public
 * namespace: the storefront, the trip page and every course page are public
 * but never framed (docs ADR 20260726-schedule-embed).
 */
describe("isEmbedRoute", () => {
  it("allows the calendar, every widget, and the framed trip page", () => {
    for (const path of [
      "/s/blue-mantis/embed/calendar",
      "/s/blue-mantis/embed/calendar/",
      ...EMBED_WIDGETS.map((widget) => `/s/blue-mantis/embed/${widget}`),
      "/s/blue-mantis/embed/trip/abc-123",
      "/s/blue-mantis/embed/trip/abc-123/",
    ]) {
      expect(isEmbedRoute(path), path).toBe(true);
    }
  });

  it("refuses everything else, the storefront and the trip page included", () => {
    for (const path of [
      // The pages a frame is the twin of: public, never framable.
      "/s/blue-mantis",
      "/s/blue-mantis/",
      "/s/blue-mantis/trips/abc-123",
      // The internal segments the deleted `?embed=1` rewrite used to land on.
      "/s/blue-mantis/embed/schedule",
      "/s/blue-mantis/trips/abc-123/embed",
      "/s/blue-mantis/embed",
      "/s/blue-mantis/embed/nope",
      "/s/blue-mantis/embed/trip",
      "/s/blue-mantis/embed/trip/abc-123/ready",
      "/s/blue-mantis/embed/grid/extra",
      "/s/Blue-Mantis/embed/calendar",
      "/s/blue-mantis/courses",
      "/s/blue-mantis/courses/open-water-diver",
      "/s/blue-mantis/trips/abc-123/calendar",
      "/shop/blue-mantis",
      "/shop/blue-mantis/embed/calendar",
      "/shop/blue-mantis/schedule/board",
      "/shop/blue-mantis/settings",
      "/sign-in",
    ]) {
      expect(isEmbedRoute(path), path).toBe(false);
    }
  });

  it("is what every path builder writes", () => {
    expect(embedCalendarPath("blue-mantis")).toBe("/s/blue-mantis/embed/calendar");
    expect(embedTripPath("blue-mantis", "abc-123")).toBe("/s/blue-mantis/embed/trip/abc-123");
    for (const widget of EMBED_WIDGETS) {
      expect(isEmbedRoute(embedWidgetPath("blue-mantis", widget)), widget).toBe(true);
    }
    expect(isEmbedRoute(embedCalendarPath("blue-mantis"))).toBe(true);
    expect(isEmbedRoute(embedTripPath("blue-mantis", "abc-123"))).toBe(true);
  });
});

/**
 * A widget path naming no widget is the proxy's 404, not the page's: under
 * partial prerendering the shell has already answered 200 by the time
 * `notFound()` runs, so a host page with a typo would frame a 200 not-found.
 */
describe("isUnknownEmbedWidgetRoute", () => {
  it("matches an embed path whose last segment is neither a widget nor the calendar", () => {
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/nope")).toBe(true);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/Grid/")).toBe(true);
    // The segment the old `?embed=1` rewrite rendered from is gone, and refused.
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/schedule")).toBe(true);
    // `trip` alone names no departure.
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/trip")).toBe(true);
  });

  it("leaves every real widget, the calendar, and every other path alone", () => {
    for (const segment of [...EMBED_WIDGETS, "calendar"]) {
      const path = `/s/blue-mantis/embed/${segment}`;
      expect(isUnknownEmbedWidgetRoute(path), path).toBe(false);
    }
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/trip/abc-123")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/grid/extra")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/shop/blue-mantis/embed/nope")).toBe(false);
  });
});
