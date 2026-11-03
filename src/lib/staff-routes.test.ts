import { readdirSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { describe, expect, it } from "vitest";
import { STAFF_ROUTES, type StaffRouteKey, staffRouteAt, wayUpHref } from "./staff-routes";

/**
 * **Every staff page is a node** (issue #2748). This replaces a scan of each
 * page's sources for a back-link marker, which carried exemptions: a header
 * that derives its parent from the URL cannot omit it, so the one thing left
 * to hold is that the tree and the file system list the same pages.
 */
const SHOP_DIR = join(import.meta.dirname, "..", "app", "shop", "[shopSlug]");

function pageDirectories(directory = SHOP_DIR): string[] {
  const entries = readdirSync(directory, { withFileTypes: true });
  const found = entries.some((entry) => entry.isFile() && entry.name === "page.tsx")
    ? [relative(SHOP_DIR, directory).split(sep).join("/")]
    : [];
  for (const entry of entries) {
    if (entry.isDirectory() && !entry.name.startsWith("_")) {
      found.push(...pageDirectories(join(directory, entry.name)));
    }
  }
  return found;
}

/** A concrete pathname for a key: each `[param]` becomes `p-<param>`. */
function samplePath(key: string): string {
  const filled = key.replace(/\[([^\]]+)\]/g, "p-$1");
  return `/shop/blue-mantis${filled === "" ? "" : `/${filled}`}`;
}

describe("the staff route tree", () => {
  it("has one node per page.tsx under /shop/[shopSlug], and no other", () => {
    expect(Object.keys(STAFF_ROUTES).sort()).toEqual(pageDirectories().sort());
  });

  it("resolves every node to itself", () => {
    for (const key of Object.keys(STAFF_ROUTES) as StaffRouteKey[]) {
      expect(staffRouteAt(samplePath(key))?.key, key).toBe(key);
    }
  });

  it("points every way up at a page in the tree", () => {
    for (const key of Object.keys(STAFF_ROUTES) as StaffRouteKey[]) {
      const parent = staffRouteAt(samplePath(key))?.parentHref;
      if (parent == null) continue;
      expect(staffRouteAt(parent), `${key} -> ${parent}`).not.toBeNull();
    }
  });
});

describe("staffRouteAt", () => {
  const up = (pathname: string) => staffRouteAt(pathname)?.parentHref;

  it("gives depth 1 and the shop home no way up", () => {
    expect(up("/shop/blue-mantis")).toBeNull();
    expect(up("/shop/blue-mantis/divers")).toBeNull();
    expect(up("/shop/blue-mantis/schedule/board")).toBeNull();
    expect(up("/shop/blue-mantis/me/security")).toBeNull();
  });

  it("reads the parent off the URL", () => {
    expect(up("/shop/blue-mantis/settings/team")).toBe("/shop/blue-mantis/settings");
    expect(up("/shop/blue-mantis/orders/o-1")).toBe("/shop/blue-mantis/orders");
    expect(up("/shop/blue-mantis/gear/work-orders/w-1/tag")).toBe(
      "/shop/blue-mantis/gear/work-orders/w-1",
    );
    // `rentals` has no page of its own, so the nearest page above is Gear.
    expect(up("/shop/blue-mantis/gear/rentals/new")).toBe("/shop/blue-mantis/gear");
    expect(up("/shop/blue-mantis/orders/o-1/print/dispute")).toBe("/shop/blue-mantis/orders/o-1");
  });

  it("prefers a static segment over a param, as the router does", () => {
    expect(staffRouteAt("/shop/blue-mantis/divers/new")?.key).toBe("divers/new");
    expect(staffRouteAt("/shop/blue-mantis/divers/d-1")?.key).toBe("divers/[personId]");
    expect(staffRouteAt("/shop/blue-mantis/gear/work-orders")?.key).toBe("gear/work-orders");
    expect(staffRouteAt("/shop/blue-mantis/gear/g-1")?.key).toBe("gear/[id]");
  });

  it("takes the parent a node names where the URL lies", () => {
    expect(up("/shop/blue-mantis/boats")).toBe("/shop/blue-mantis/settings");
    expect(up("/shop/blue-mantis/me/email")).toBe("/shop/blue-mantis/me/security");
    expect(up("/shop/blue-mantis/settings/export/backups")).toBe("/shop/blue-mantis/settings");
    expect(up("/shop/blue-mantis/bookings/new/t-1")).toBe("/shop/blue-mantis/schedule/board");
    expect(up("/shop/blue-mantis/schedule/day/2026-11-03")).toBe(
      "/shop/blue-mantis/schedule/board",
    );
    expect(up("/shop/blue-mantis/schedule/blowout/t-1")).toBe("/shop/blue-mantis/trips/t-1");
  });

  it("sends a departure's faces to the board, and what is below a face to the face", () => {
    expect(up("/shop/blue-mantis/trips/t-1")).toBe("/shop/blue-mantis/schedule/board");
    expect(up("/shop/blue-mantis/trips/t-1/manifest")).toBe("/shop/blue-mantis/schedule/board");
    expect(up("/shop/blue-mantis/trips/t-1/print/medical-alerts")).toBe(
      "/shop/blue-mantis/schedule/board",
    );
    expect(up("/shop/blue-mantis/trips/t-1/log")).toBe("/shop/blue-mantis/trips/t-1");
    expect(up("/shop/blue-mantis/trips/t-1/party/l-1/waivers")).toBe("/shop/blue-mantis/trips/t-1");
    expect(up("/shop/blue-mantis/trips/t-1/prep/ticket/b-1")).toBe(
      "/shop/blue-mantis/trips/t-1/prep#packing-list",
    );
  });

  it("lands on the part of the parent the page came from", () => {
    expect(up("/shop/blue-mantis/trips/t-1/incidents/r-1")).toBe(
      "/shop/blue-mantis/trips/t-1?view=details#incidents",
    );
    expect(up("/shop/blue-mantis/divers/d-1/waivers/w-1")).toBe(
      "/shop/blue-mantis/divers/d-1#waiver",
    );
  });

  it("ignores a query and a hash, and refuses what is not a staff page", () => {
    expect(up("/shop/blue-mantis/orders/o-1?notice=saved#top")).toBe("/shop/blue-mantis/orders");
    expect(staffRouteAt("/shop/blue-mantis/no-such-page")).toBeNull();
    expect(staffRouteAt("/s/blue-mantis/reviews")).toBeNull();
    expect(staffRouteAt("/shop")).toBeNull();
  });
});

describe("wayUpHref", () => {
  it("answers for staff pages from the tree", () => {
    expect(wayUpHref("/shop/blue-mantis/settings/billing")).toBe("/shop/blue-mantis/settings");
  });

  it("sends a diver's reviews, site and trip pages to the shop's schedule", () => {
    expect(wayUpHref("/s/blue-mantis/reviews")).toBe("/s/blue-mantis");
    expect(wayUpHref("/s/blue-mantis/sites/molasses")).toBe("/s/blue-mantis");
    expect(wayUpHref("/s/blue-mantis/trips/t-1")).toBe("/s/blue-mantis");
  });

  it("gives every other page none", () => {
    expect(wayUpHref("/s/blue-mantis")).toBeNull();
    expect(wayUpHref("/s/blue-mantis/courses")).toBeNull();
    expect(wayUpHref("/ready/token")).toBeNull();
    // The offline manifest is not under `/shop/`: its eyebrow never links.
    expect(wayUpHref("/offline-manifest")).toBeNull();
    expect(wayUpHref("")).toBeNull();
  });
});
