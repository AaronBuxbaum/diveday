import { describe, expect, it } from "vitest";
import {
  STAFF_DESTINATIONS,
  type StaffDestinationGates,
  staffDestinationHref,
  staffNavDestinations,
  staffPaletteDestinations,
  staffShopRoot,
  staffShortcutDestinations,
  visibleStaffDestinations,
} from "./staff-destinations";

const owner: StaffDestinationGates = { waivers: true, reports: true, team: true };
const crew: StaffDestinationGates = { waivers: false, reports: false, team: false };

describe("the staff destination registry", () => {
  it("gives every destination a unique id and a unique path", () => {
    const ids = STAFF_DESTINATIONS.map((destination) => destination.id);
    const suffixes = STAFF_DESTINATIONS.map((destination) => destination.suffix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(suffixes).size).toBe(suffixes.length);
  });

  it("never gives two destinations the same keyboard shortcut", () => {
    const keys = STAFF_DESTINATIONS.flatMap((destination) =>
      destination.shortcut ? [destination.shortcut] : [],
    );
    expect(new Set(keys).size).toBe(keys.length);
    // `g` starts the sequence, so it can never also end one.
    expect(keys).not.toContain("g");
  });

  it("keeps every destination reachable from at least one surface", () => {
    for (const destination of STAFF_DESTINATIONS) {
      expect(
        destination.navGroup !== null || destination.inPalette,
        `${destination.id} is in neither the nav nor the palette`,
      ).toBe(true);
    }
  });

  it("builds a shop-scoped href, with Today at the shop root", () => {
    const root = staffShopRoot("blue-mantis");
    expect(root).toBe("/shop/blue-mantis");
    const today = STAFF_DESTINATIONS.find((destination) => destination.id === "today");
    const orders = STAFF_DESTINATIONS.find((destination) => destination.id === "orders");
    if (!today || !orders) throw new Error("registry lost a destination");
    expect(staffDestinationHref(root, today)).toBe("/shop/blue-mantis");
    expect(staffDestinationHref(root, orders)).toBe("/shop/blue-mantis/orders");
  });
});

describe("permission gating", () => {
  it("hides every gated destination from crew, in every consumer", () => {
    const gated = STAFF_DESTINATIONS.filter((destination) => destination.gate !== undefined).map(
      (destination) => destination.id,
    );
    expect(gated).toEqual(["waivers", "reports", "promoCodes", "team"]);

    const visible = visibleStaffDestinations(crew).map((destination) => destination.id);
    const palette = staffPaletteDestinations(crew).map((destination) => destination.id);
    const shortcuts = staffShortcutDestinations(crew).map((destination) => destination.id);
    const nav = [
      ...staffNavDestinations("primary", crew),
      ...staffNavDestinations("daily", crew),
      ...staffNavDestinations("setup", crew),
    ].map((destination) => destination.id);

    for (const id of gated) {
      expect(visible).not.toContain(id);
      expect(palette).not.toContain(id);
      expect(shortcuts).not.toContain(id);
      expect(nav).not.toContain(id);
    }
  });

  it("shows an owner everything", () => {
    expect(visibleStaffDestinations(owner)).toHaveLength(STAFF_DESTINATIONS.length);
  });

  it("gates promo codes on the same permission as reports", () => {
    const reportsOnly: StaffDestinationGates = { waivers: false, reports: true, team: false };
    const ids = visibleStaffDestinations(reportsOnly).map((destination) => destination.id);
    expect(ids).toContain("reports");
    expect(ids).toContain("promoCodes");
    expect(ids).not.toContain("waivers");
    expect(ids).not.toContain("team");
  });
});

describe("what each consumer derives", () => {
  it("lays the header out as five primary tabs, then two labelled More groups", () => {
    expect(staffNavDestinations("primary", owner).map((d) => d.id)).toEqual([
      "today",
      "checkIn",
      "blockers",
      "divers",
      "board",
    ]);
    expect(staffNavDestinations("daily", owner).map((d) => d.id)).toEqual([
      "staffing",
      "diveSites",
      "courses",
      "reviews",
      "orders",
      "waivers",
      "reports",
    ]);
    expect(staffNavDestinations("setup", owner).map((d) => d.id)).toEqual([
      "promoCodes",
      "settings",
      "team",
    ]);
  });

  it("puts Orders in the nav, where a daily money surface belongs", () => {
    const orders = STAFF_DESTINATIONS.find((destination) => destination.id === "orders");
    expect(orders?.navGroup).toBe("daily");
    expect(orders?.inPalette).toBe(true);
  });

  it("offers the palette everything except the walk-in-free header", () => {
    // Walk-in is palette-only; everything in the header is also in the palette.
    const palette = staffPaletteDestinations(owner).map((d) => d.id);
    expect(palette).toContain("walkIn");
    for (const destination of STAFF_DESTINATIONS) {
      if (destination.navGroup !== null) expect(palette).toContain(destination.id);
    }
  });

  it("gives the shortcut sheet the five sequences, waivers only when permitted", () => {
    expect(staffShortcutDestinations(owner).map((d) => `g ${d.shortcut}`)).toEqual([
      "g t",
      "g b",
      "g d",
      "g s",
      "g w",
    ]);
    expect(staffShortcutDestinations(crew).map((d) => d.shortcut)).toEqual(["t", "b", "d", "s"]);
  });

  it("keeps a trip's detail page lit on the board tab", () => {
    const board = STAFF_DESTINATIONS.find((destination) => destination.id === "board");
    expect(board?.suffix).toBe("/schedule/board");
    expect(board?.alsoMatch).toBe("/trips");
  });

  it("badges only the two counted queues", () => {
    const badged = STAFF_DESTINATIONS.filter((destination) => destination.badge !== undefined);
    expect(badged.map((destination) => [destination.id, destination.badge])).toEqual([
      ["blockers", "blockers"],
      ["reviews", "reviews"],
    ]);
  });
});
