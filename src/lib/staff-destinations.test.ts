import { describe, expect, it } from "vitest";
import {
  STAFF_DESTINATIONS,
  type StaffDestinationGates,
  type StaffDestinationId,
  staffDestination,
  staffDestinationHref,
  staffDestinationSuffix,
  staffNavDestinations,
  staffPaletteDestinations,
  staffShopRoot,
  visibleStaffDestinations,
} from "./staff-destinations";

const owner: StaffDestinationGates = {
  waivers: true,
  reports: true,
  team: true,
  settings: true,
};
const crew: StaffDestinationGates = {
  waivers: false,
  reports: false,
  team: false,
  settings: false,
};

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
    expect(gated).toEqual(["waivers", "reports", "promoCodes", "team", "settings"]);

    const visible = visibleStaffDestinations(crew).map((destination) => destination.id);
    const palette = staffPaletteDestinations(crew).map((destination) => destination.id);
    const nav = [
      ...staffNavDestinations("primary", crew),
      ...staffNavDestinations("daily", crew),
      ...staffNavDestinations("setup", crew),
    ].map((destination) => destination.id);

    for (const id of gated) {
      expect(visible).not.toContain(id);
      expect(palette).not.toContain(id);
      expect(nav).not.toContain(id);
    }
  });

  it("shows an owner everything", () => {
    expect(visibleStaffDestinations(owner)).toHaveLength(STAFF_DESTINATIONS.length);
  });

  it("gates promo codes on the same permission as reports", () => {
    const reportsOnly: StaffDestinationGates = {
      waivers: false,
      reports: true,
      team: false,
      settings: false,
    };
    const ids = visibleStaffDestinations(reportsOnly).map((destination) => destination.id);
    expect(ids).toContain("reports");
    expect(ids).toContain("promoCodes");
    expect(ids).not.toContain("waivers");
    expect(ids).not.toContain("team");
  });
});

describe("what each consumer derives", () => {
  it("lays the header out as five tabs and no More menu", () => {
    // The header holds only places a shop lives in *during a dive day*;
    // everything demoted keeps its palette row or a contextual
    // door on the surface that owns it — Reports from Orders' header, Dive
    // sites and Waivers from Settings' cards, Close-out from Today's evening
    // handoff, Reviews as a Today queue row, and Settings itself from the
    // header's shop-identity menu.
    expect(staffNavDestinations("primary", owner).map((d) => d.id)).toEqual([
      "today",
      "checkIn",
      "divers",
      "board",
      "orders",
    ]);
    // Both "More" groups are deliberately empty: a menu named "More" was the
    // IA admitting it hadn't decided, and the header no longer renders one
    // with nothing to hold.
    expect(staffNavDestinations("daily", owner)).toEqual([]);
    expect(staffNavDestinations("setup", owner)).toEqual([]);
  });

  it("keeps a header destination out of the Settings page's own card list, and back", () => {
    const inHeader = (id: StaffDestinationId) => staffDestination(id).navGroup !== null;
    // Reachable from Settings' cards → not a header row.
    expect(inHeader("team")).toBe(false);
    expect(inHeader("promoCodes")).toBe(false);
    // Settings itself is no longer one either: it is the one destination a
    // shop configures rather than works, and it was costing a sixth of the
    // phone dock. Its permanent door is the header's shop-identity menu.
    expect(inHeader("settings")).toBe(false);
    // Read every day → a header row, and no Settings card.
    expect(inHeader("orders")).toBe(true);
    // Both still answer by name in ⌘K, which is where a destination that is
    // not in the header has to remain reachable.
    const palette = staffPaletteDestinations(owner).map((destination) => destination.id);
    expect(palette).toContain("team");
    expect(palette).toContain("promoCodes");
  });

  it("keeps the header honest for a destination that left it", () => {
    // Promo codes is reached *from* Settings, so Settings claims `/promos` as
    // a second "you are here" prefix — read now by the shop-identity menu,
    // which is Settings' own door since it left the tab strip. Without it the
    // promos page is a staff surface with nothing anywhere reading as current.
    // Team needs no entry: `/settings/team` already sits below `/settings`.
    expect(staffDestination("settings").alsoMatch).toEqual(["/promos", "/dive-sites", "/waivers"]);
    expect(staffDestination("team").suffix.startsWith(staffDestination("settings").suffix)).toBe(
      true,
    );
  });

  it("puts Settings last in the whole registry, so no consumer can list it mid-menu", () => {
    expect(STAFF_DESTINATIONS.at(-1)?.id).toBe("settings");
    expect(staffPaletteDestinations(owner).at(-1)?.id).toBe("settings");
  });

  it("puts Orders in the header, where a daily money surface belongs", () => {
    const orders = STAFF_DESTINATIONS.find((destination) => destination.id === "orders");
    expect(orders?.navGroup).toBe("primary");
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
    expect(board?.alsoMatch).toEqual(["/trips", "/staffing"]);
  });

  it("badges only the blocked count, on Today", () => {
    // The old Reviews badge became a row on Today's queue when Reviews left
    // the header — a queue's signal belongs on the page that ranks work, so
    // the nav carries exactly one number: divers who can't board.
    const badged = STAFF_DESTINATIONS.filter((destination) => destination.badge !== undefined);
    expect(badged.map((destination) => [destination.id, destination.badge])).toEqual([
      ["today", "blockers"],
    ]);
  });

  it("keeps the blocked-diver badge on exactly one destination", () => {
    // It moved from Not ready to Today when Not ready became Today's view.
    // Badging both would count the same divers twice in one header.
    const blocked = STAFF_DESTINATIONS.filter((d) => d.badge === "blockers");
    expect(blocked.map((d) => d.id)).toEqual(["today"]);
  });

  it("still reaches the by-departure view by name and by keystroke", () => {
    // Not ready is off the header, so the palette row is the only way left to
    // ask for it by name — and it must carry the view query, or it lands on
    // the urgency view and quietly does nothing.
    const blockers = STAFF_DESTINATIONS.find((destination) => destination.id === "blockers");
    if (!blockers) throw new Error("registry lost the by-departure view");
    expect(blockers.navGroup).toBeNull();
    expect(blockers.inPalette).toBe(true);
    expect(staffDestinationHref(staffShopRoot("blue-mantis"), blockers)).toBe(
      "/shop/blue-mantis?view=departures",
    );
  });
});

/**
 * Settings became owner/manager work, which put the one page under it that is
 * *not* shop configuration at risk of disappearing with it: a staffer's own
 * calendar subscription is a personal feed of their own shifts, filed under
 * `/settings` by URL only.
 */
describe("the calendar subscription survives the settings gate", () => {
  it("stays reachable for a role that cannot open settings at all", () => {
    const ids = visibleStaffDestinations(crew).map((destination) => destination.id);
    expect(ids).not.toContain("settings");
    expect(ids).toContain("calendarFeed");
  });

  it("is offered by name in the palette, since it is not in the header", () => {
    const palette = staffPaletteDestinations(crew).map((destination) => destination.id);
    expect(palette).toContain("calendarFeed");
  });

  it("hides settings and everything filed beneath it from the daily crew", () => {
    const ids = visibleStaffDestinations(crew).map((destination) => destination.id);
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("team");
  });
});
