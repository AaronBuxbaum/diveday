import { describe, expect, it } from "vitest";
import {
  EMBED_WIDGETS,
  embedPublicPath,
  embedRenderPath,
  isEmbeddableShopRoute,
  isEmbedWidgetRoute,
  isInternalEmbedRoute,
  isUnknownEmbedWidgetRoute,
} from "./embed-routes";

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

/**
 * A widget path naming no widget is the proxy's 404, not the page's: under
 * partial prerendering the shell has already answered 200 by the time
 * `notFound()` runs, so a host page with a typo would frame a 200 not-found.
 */
describe("isUnknownEmbedWidgetRoute", () => {
  it("matches an embed path whose last segment is not a widget", () => {
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/nope")).toBe(true);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/Grid/")).toBe(true);
  });

  it("leaves every real widget, and every other path, alone", () => {
    for (const widget of ["grid", "departure", "courses", "reviews"]) {
      const path = `/s/blue-mantis/embed/${widget}`;
      expect(isUnknownEmbedWidgetRoute(path), path).toBe(false);
      expect(isEmbedWidgetRoute(path), path).toBe(true);
    }
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis/embed/grid/extra")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/s/blue-mantis")).toBe(false);
    expect(isUnknownEmbedWidgetRoute("/shop/blue-mantis/embed/nope")).toBe(false);
  });
});

/**
 * **A framed page renders from a segment of its own** (K-371, K-382). A
 * segment's `loading.tsx` cannot read `?embed=1`, so the schedule and the trip
 * page streamed into a shop's iframe under their full-page skeletons — a
 * centred column under a bar — and then snapped to the frame's full-width
 * column. The proxy rewrites an embed request onto an internal segment whose
 * skeleton is the frame's own; these pin where each one goes, which public
 * page each segment stands for when the rewrite comes back through the proxy,
 * and that neither segment is framable by its path.
 */
describe("embedRenderPath", () => {
  it("sends the framed schedule and trip page to their own segments", () => {
    expect(embedRenderPath("/s/blue-mantis")).toBe("/s/blue-mantis/embed/schedule");
    expect(embedRenderPath("/s/blue-mantis/")).toBe("/s/blue-mantis/embed/schedule");
    expect(embedRenderPath("/s/blue-mantis/trips/abc-123")).toBe(
      "/s/blue-mantis/trips/abc-123/embed",
    );
    expect(embedRenderPath("/s/blue-mantis/trips/abc-123/")).toBe(
      "/s/blue-mantis/trips/abc-123/embed",
    );
  });

  it("leaves a widget, which is its own segment already, and every other route alone", () => {
    for (const path of [
      "/s/blue-mantis/embed/grid",
      "/s/blue-mantis/courses",
      "/s/blue-mantis/trips/abc-123/calendar",
      "/shop/blue-mantis",
      "/",
    ]) {
      expect(embedRenderPath(path), path).toBeNull();
    }
  });

  it("keeps the schedule's segment out of the widget catalog", () => {
    // `embed/schedule` is a static segment beside `embed/[widget]`, and a
    // direct request for it is refused because it names no widget. Listing it
    // would make it a widget view: framable by path, with no `?embed=1`.
    expect(EMBED_WIDGETS as readonly string[]).not.toContain("schedule");
    const schedule = embedRenderPath("/s/blue-mantis") ?? "";
    expect(isEmbedWidgetRoute(schedule)).toBe(false);
    expect(isUnknownEmbedWidgetRoute(schedule)).toBe(true);
  });
});

describe("isInternalEmbedRoute", () => {
  it("names both internal segments, however the shop is spelled", () => {
    for (const path of [
      "/s/blue-mantis/embed/schedule",
      "/s/blue-mantis/embed/schedule/",
      "/s/Blue%2Dmantis/embed/schedule",
      "/s/blue-mantis/trips/abc-123/embed",
      "/s/blue-mantis/trips/abc-123/embed/",
    ]) {
      expect(isInternalEmbedRoute(path), path).toBe(true);
    }
  });

  it("is never the page a host frames, and never grants the framing exception by path", () => {
    for (const path of ["/s/blue-mantis", "/s/blue-mantis/trips/abc-123"]) {
      expect(isInternalEmbedRoute(path), path).toBe(false);
      const internal = embedRenderPath(path) ?? "";
      expect(isInternalEmbedRoute(internal), internal).toBe(true);
      expect(isEmbeddableShopRoute(internal), internal).toBe(false);
      expect(isEmbedWidgetRoute(internal), internal).toBe(false);
    }
    expect(isInternalEmbedRoute("/s/blue-mantis/embed/grid")).toBe(false);
    expect(isInternalEmbedRoute("/s/blue-mantis/trips/abc-123/calendar")).toBe(false);
    expect(isInternalEmbedRoute("/shop/blue-mantis/trips/abc-123/embed")).toBe(false);
  });
});

describe("embedPublicPath", () => {
  it("names the public page each internal segment stands for, undoing embedRenderPath", () => {
    // On a server started on 127.0.0.1 the rewrite is a request of its own,
    // and this is how the proxy's second pass knows which page it is judging.
    for (const path of ["/s/blue-mantis", "/s/blue-mantis/trips/abc-123"]) {
      const internal = embedRenderPath(path) ?? "";
      expect(embedPublicPath(internal), internal).toBe(path);
      expect(embedPublicPath(`${internal}/`), internal).toBe(path);
    }
  });

  it("stands for nothing on any other path, or at a shop spelling no embed request has", () => {
    for (const path of [
      "/s/blue-mantis",
      "/s/blue-mantis/trips/abc-123",
      "/s/blue-mantis/embed/grid",
      "/s/blue-mantis/embed/nope",
      "/s/blue-mantis/trips/abc-123/calendar",
      "/shop/blue-mantis/embed/schedule",
      "/s/Blue-Mantis/embed/schedule",
      "/s/blue%2Dmantis/trips/abc-123/embed",
      "/s/blue-mantis/trips/embed",
    ]) {
      expect(embedPublicPath(path), path).toBeNull();
    }
  });
});
