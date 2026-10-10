import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

import {
  internalPath,
  isStaffRoute,
  ledgerRoutes,
  MAX_SHEET_BYTES,
  NOT_FOUND_MARKER,
  nextVisit,
  routeFor,
  routePattern,
  TILE,
  tileGeometry,
} from "./contact-sheet.mjs";

const routes = [
  "/",
  "/ready/[token]",
  "/s/blue-mantis",
  "/s/blue-mantis/trips/[id]",
  "/shop/blue-mantis/divers",
  "/shop/blue-mantis/divers/[personId]",
  "/shop/blue-mantis/divers/new",
  "/shop/blue-mantis/trips/[id]",
  "/shop/blue-mantis/trips/[id]/manifest",
];

describe("the inventory", () => {
  it("comes from the route ledger, with the demo shop's slug in place", () => {
    const ledger = JSON.parse(
      readFileSync(path.join(process.cwd(), "scripts/route-coverage.json"), "utf8"),
    );
    const listed = ledgerRoutes(ledger);
    expect(listed).toContain("/shop/blue-mantis/trips/[id]/manifest");
    expect(listed).toContain("/s/blue-mantis");
    expect(listed.some((route) => route.includes("[shopSlug]"))).toBe(false);
    expect(listed).not.toContain("//");
  });
});

describe("route shapes", () => {
  it("collapses ids and tokens into the route they are an instance of", () => {
    expect(routeFor(routes, "/shop/blue-mantis/trips/8f2c1d9e-1111-4111-8111-111111111111")).toBe(
      "/shop/blue-mantis/trips/[id]",
    );
    expect(routeFor(routes, "/ready/abcDEF123_-")).toBe("/ready/[token]");
  });

  it("keeps a sub-page its own shape, so a deeper route is not folded into its parent", () => {
    expect(routeFor(routes, "/shop/blue-mantis/trips/t1/manifest")).toBe(
      "/shop/blue-mantis/trips/[id]/manifest",
    );
    expect(routeFor(routes, "/shop/blue-mantis/trips/t1")).toBe("/shop/blue-mantis/trips/[id]");
  });

  it("lets a static route win over a dynamic one that also matches", () => {
    expect(routeFor(routes, "/shop/blue-mantis/divers/new")).toBe("/shop/blue-mantis/divers/new");
  });

  it("matches nothing for a path the app does not have", () => {
    expect(routeFor(routes, "/shop/blue-mantis/nowhere/at/all")).toBeNull();
    expect(routePattern("/a/[b]").test("/a/b/c")).toBe(false);
  });

  it("strips queries and fragments and leaves other sites out", () => {
    const base = "http://localhost:3000";
    expect(internalPath("/shop/blue-mantis/divers?page=2#top", base)).toBe(
      "/shop/blue-mantis/divers",
    );
    expect(internalPath("/s/blue-mantis/", base)).toBe("/s/blue-mantis");
    expect(internalPath("https://padi.com/x", base)).toBeNull();
    expect(internalPath("mailto:a@b.c", base)).toBeNull();
  });

  it("photographs a staff route signed in and every other one signed out", () => {
    expect(isStaffRoute("/shop/blue-mantis")).toBe(true);
    expect(isStaffRoute("/s/blue-mantis")).toBe(false);
    expect(isStaffRoute("/ready/[token]")).toBe(false);
  });
});

describe("the visit order and the budget", () => {
  const state = (overrides = {}) => ({
    routes,
    filled: new Map(),
    done: new Set(),
    visits: 0,
    budget: 50,
    ...overrides,
  });

  it("opens every static route before any dynamic one", () => {
    const filled = new Map([["/shop/blue-mantis/trips/[id]", "/shop/blue-mantis/trips/t1"]]);
    expect(nextVisit(state({ filled }))).toEqual({ route: "/", pathname: "/" });
  });

  it("opens a dynamic route only once a link has filled it", () => {
    const done = new Set(routes.filter((route) => !route.includes("[")));
    expect(nextVisit(state({ done }))).toBeNull();
    const filled = new Map([["/ready/[token]", "/ready/tok"]]);
    expect(nextVisit(state({ done, filled }))).toEqual({
      route: "/ready/[token]",
      pathname: "/ready/tok",
    });
  });

  it("stops at the budget", () => {
    expect(nextVisit(state({ visits: 50 }))).toBeNull();
  });
});

describe("the sheet", () => {
  it("tiles a count that does not divide evenly into the rows it needs", () => {
    const geometry = tileGeometry(23, 10, TILE, 44);
    expect(geometry.rows).toBe(3);
    expect(geometry.width).toBe(10 * TILE.width);
    expect(geometry.height).toBe(3 * (TILE.height + 44));
    expect(geometry.position(0)).toEqual({ x: 0, y: 0 });
    expect(geometry.position(10)).toEqual({ x: 0, y: TILE.height + 44 });
    expect(geometry.position(22)).toEqual({ x: 2 * TILE.width, y: 2 * (TILE.height + 44) });
  });

  it("is no wider than its tiles when there are fewer than a row", () => {
    expect(tileGeometry(3, 10, TILE, 44).width).toBe(3 * TILE.width);
  });

  it("treats a page that rendered the not-found boundary as a miss, whatever its status", () => {
    expect(NOT_FOUND_MARKER).toContain('meta[name="next-error"][content="not-found"]');
    expect(NOT_FOUND_MARKER).toContain('meta[name="boundary-next-error"][content="not-found"]');
  });

  it("stays under the design-canvas guard's cap", () => {
    expect(MAX_SHEET_BYTES).toBeLessThan(400_000);
  });
});
