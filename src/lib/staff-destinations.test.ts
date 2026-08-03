import { describe, expect, it } from "vitest";
import {
  STAFF_DESTINATIONS,
  type StaffDestinationGates,
  staffDestinationHref,
  staffDestinationSuffix,
  staffNavDestinations,
  staffPaletteDestinations,
  staffShopRoot,
  staffShortcutDestinations,
  visibleStaffDestinations,
} from "./staff-destinations";

const owner: StaffDestinationGates = { waivers: true, reports: true, team: true };
const crew: StaffDestinationGates = { waivers: false, reports: false, team: false };

describe("the staff destination registry", () => {
  it("gives every destination a unique id and a unique URL", () => {
    const ids = STAFF_DESTINATIONS.map((destination) => destination.id);
    // Suffix *plus* view query: Today and its by-departure view share a path
    // and are told apart by `?view=`, which is the whole point of a view. Two
    // destinations resolving to the same full URL would still be a bug.
    const urls = STAFF_DESTINATIONS.map(staffDestinationSuffix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  it("only lets a view — never a page — share another destination's path", () => {
    for (const destination of STAFF_DESTINATIONS) {
      const twins = STAFF_DESTINATIONS.filter(
        (other) => other.suffix === destination.suffix && other.id !== destination.id,
      );
      for (const twin of twins) {
        expect(
          Boolean(destination.query) || Boolean(twin.query),
          `${destination.id} and ${twin.id} share a path with no view query`,
        ).toBe(true);
      }
    }
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
  it("lays the header out as four primary tabs, then two labelled More groups", () => {
    // Not ready lost its tab when it became Today's by-departure view: a tab
    // beside Today that only re-sorts Today's own queue is the duplicate
    // control design principle 8 rules out. Its badge moved onto Today.
    expect(staffNavDestinations("primary", owner).map((d) => d.id)).toEqual([
      "today",
      "checkIn",
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

  it("offers the palette everything in the header, plus the header-free surfaces", () => {
    // Walk-in and the by-departure view are palette-only; everything in the
    // header is also in the palette.
    const palette = staffPaletteDestinations(owner).map((d) => d.id);
    expect(palette).toContain("walkIn");
    expect(palette).toContain("blockers");
    for (const destination of STAFF_DESTINATIONS) {
      if (destination.navGroup !== null) expect(palette).toContain(destination.id);
    }
  });

  it("gives the shortcut sheet its sequences, waivers only when permitted", () => {
    expect(staffShortcutDestinations(owner).map((d) => `g ${d.shortcut}`)).toEqual([
      "g t",
      "g b",
      "g d",
      "g s",
      "g a",
      "g w",
    ]);
    expect(staffShortcutDestinations(crew).map((d) => d.shortcut)).toEqual([
      "t",
      "b",
      "d",
      "s",
      "a",
    ]);
  });

  it("declares the global Add-a-booking door here rather than in the palette", () => {
    // It used to be a hand-written item inside CommandPalette.tsx — a
    // destination living in one consumer and nowhere else, which is the drift
    // this registry exists to end. Palette-only on purpose: it is an action,
    // and the board keeps its own button for it.
    const addBooking = STAFF_DESTINATIONS.find((d) => d.id === "addBooking");
    if (!addBooking) throw new Error("registry lost the add-booking door");
    expect(addBooking.suffix).toBe("/bookings/new");
    expect(addBooking.navGroup).toBeNull();
    expect(addBooking.inPalette).toBe(true);
    expect(addBooking.gate).toBeUndefined();
    expect(staffDestinationHref(staffShopRoot("blue-mantis"), addBooking)).toBe(
      "/shop/blue-mantis/bookings/new",
    );
    // Seating a diver is front-desk work, not owner work, so the crew keeps it.
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("addBooking");
  });

  it("keeps a trip's detail page lit on the board tab", () => {
    const board = STAFF_DESTINATIONS.find((destination) => destination.id === "board");
    expect(board?.suffix).toBe("/schedule/board");
    expect(board?.alsoMatch).toBe("/trips");
  });

  it("badges only the two counted queues, with the blocked count on Today", () => {
    const badged = STAFF_DESTINATIONS.filter((destination) => destination.badge !== undefined);
    expect(badged.map((destination) => [destination.id, destination.badge])).toEqual([
      ["today", "blockers"],
      ["reviews", "reviews"],
    ]);
  });

  it("keeps the blocked-diver badge on exactly one destination", () => {
    // It moved from Not ready to Today when Not ready became Today's view.
    // Badging both would count the same divers twice in one header.
    const blocked = STAFF_DESTINATIONS.filter((d) => d.badge === "blockers");
    expect(blocked.map((d) => d.id)).toEqual(["today"]);
  });

  it("still reaches the by-departure view by name and by keystroke", () => {
    // Not ready is off the header, so the palette row and `g b` are the only
    // ways left to ask for it by name — and both must carry the view query,
    // or they land on the urgency view and quietly do nothing.
    const blockers = STAFF_DESTINATIONS.find((destination) => destination.id === "blockers");
    if (!blockers) throw new Error("registry lost the by-departure view");
    expect(blockers.navGroup).toBeNull();
    expect(blockers.inPalette).toBe(true);
    expect(blockers.shortcut).toBe("b");
    expect(staffDestinationHref(staffShopRoot("blue-mantis"), blockers)).toBe(
      "/shop/blue-mantis?view=departures",
    );
  });
});
