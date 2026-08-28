import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentStaffNavDestinationId,
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATION_TITLE_KEYS,
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
    const urls = STAFF_DESTINATIONS.map(staffDestinationSuffix);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(urls).size).toBe(urls.length);
  });

  /**
   * **No destination is a *view* of another page any more.** Exactly one ever
   * was — "Not ready", behind `?view=departures` on the shop home — and it went
   * when the home became one chronological spine (ADR
   * 20260827-clearwater-surface-language, decision 4). A registry entry whose
   * URL is a query string on somebody else's page is a second palette row
   * landing where the first one already goes.
   */
  it("declares no destination as a query on another destination's path", () => {
    for (const destination of STAFF_DESTINATIONS) {
      expect(destination.suffix, destination.id).not.toContain("?");
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

/**
 * **The eyebrow a page wears and the tab that led to it are one string.**
 *
 * Eight staff surfaces greeted a staffer with a name other than the one they
 * tapped, and four of them were doing the right thing through a *second copy*
 * of the word — `reviews.eyebrow` "Reviews" beside `shared.shopNavLinks.reviews`
 * "Reviews" (issue #824). These pin the join rather than the words: what
 * matters is that there is exactly one key per destination and that every page
 * reads it rather than a twin of it.
 */
describe("the one word per destination", () => {
  const bundle = (name: string) =>
    JSON.parse(
      readFileSync(
        path.join(import.meta.dirname, "..", "i18n", "locales", "en-US", "staff", `${name}.json`),
        "utf8",
      ),
    ) as Record<string, unknown>;

  function resolve(key: string): unknown {
    const [namespace, ...rest] = key.split(".");
    if (!namespace) return undefined;
    let current: unknown = bundle(namespace);
    for (const step of rest) {
      if (typeof current !== "object" || current === null) return undefined;
      current = (current as Record<string, unknown>)[step];
    }
    return current;
  }

  it("has a label key for every destination, and no others", () => {
    expect(Object.keys(STAFF_DESTINATION_LABEL_KEYS).sort()).toEqual(
      STAFF_DESTINATIONS.map((destination) => destination.id).sort(),
    );
  });

  it("points every key at a real string in the staff bundle", () => {
    for (const key of Object.values(STAFF_DESTINATION_LABEL_KEYS)) {
      expect(typeof resolve(key), key).toBe("string");
    }
    for (const key of Object.values(STAFF_DESTINATION_TITLE_KEYS)) {
      expect(typeof resolve(key), key).toBe("string");
    }
  });

  /**
   * The whole point of the title record: a destination whose page calls itself
   * what the tab calls it does not belong in it, because the palette would
   * then match the same row twice for no gain.
   */
  it("only lists a title where the page genuinely calls itself something else", () => {
    for (const [id, titleKey] of Object.entries(STAFF_DESTINATION_TITLE_KEYS)) {
      const label = resolve(STAFF_DESTINATION_LABEL_KEYS[id as StaffDestinationId]);
      expect(resolve(titleKey), id).not.toBe(label);
    }
  });
});

describe("permission gating", () => {
  it("hides every gated destination from crew, in every consumer", () => {
    const gated = STAFF_DESTINATIONS.filter((destination) => destination.gate !== undefined).map(
      (destination) => destination.id,
    );
    // Requests carries the `reports` gate rather than none: it is a pile of
    // contact details for people who have not booked, and deciding which
    // unscheduled day is worth a boat is the same commercial work Reports and
    // Promo codes sit behind.
    expect(gated).toEqual(["waivers", "requests", "reports", "team", "promoCodes", "settings"]);

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

  it("never renders an empty More surface for any role: each group keeps ungated rows", () => {
    // The dock's sixth slot and the header menu render only when they have
    // rows. Staffing (daily) and the calendar feed (setup) are deliberately
    // ungated, so even the barest crew role gets both groups.
    expect(staffNavDestinations("daily", crew).length).toBeGreaterThan(0);
    expect(staffNavDestinations("setup", crew).length).toBeGreaterThan(0);
  });
});

describe("what each consumer derives", () => {
  it("lays the nav out as four primary tabs plus the two More groups", () => {
    // The tabs are the places a shop lives in *during a dive day*; the dock
    // has room for five and its sixth slot is spent on the More sheet.
    // Everything else that is a *place* files under "Run the shop" (the
    // operational cadence) or "Set up" (configuration), with Settings closing
    // the menu (ADR 20260813-more-is-the-shops-other-door).
    //
    // **Four, since H-62.** Close-out left the dock on 2026-08-28 when the
    // evening became a state of the shop home rather than a destination (ADR
    // 20260827-clearwater-surface-language, decision 4), and the room it freed
    // is deliberately unspent.
    expect(staffNavDestinations("primary", owner).map((d) => d.id)).toEqual([
      "today",
      "checkIn",
      "divers",
      "board",
    ]);
    expect(staffNavDestinations("daily", owner).map((d) => d.id)).toEqual([
      "staffing",
      "courses",
      "diveSites",
      "gear",
      "waivers",
      "reviews",
      "requests",
      "orders",
      "reports",
    ]);
    expect(staffNavDestinations("setup", owner).map((d) => d.id)).toEqual([
      "team",
      "promoCodes",
      "calendarFeed",
      "settings",
    ]);
  });

  it("keeps only non-places out of the nav", () => {
    // `navGroup: null` is not a demotion — it is the statement that the entry
    // is an action (addBooking) or a way into a page (walkIn), not a place a
    // menu should list.
    const outOfNav = STAFF_DESTINATIONS.filter((destination) => destination.navGroup === null).map(
      (destination) => destination.id,
    );
    expect(outOfNav).toEqual(["addBooking", "walkIn"]);
  });

  it("puts Settings last in the whole registry, so no consumer can list it mid-menu", () => {
    expect(STAFF_DESTINATIONS.at(-1)?.id).toBe("settings");
    expect(staffPaletteDestinations(owner).at(-1)?.id).toBe("settings");
    expect(staffNavDestinations("setup", owner).at(-1)?.id).toBe("settings");
  });

  it("has no Close-out destination at all, and keeps Orders in More", () => {
    // The evening is a state the shop home settles into, not a place to go
    // (H-62). An entry pointing at the bare home would be a second row landing
    // on Today's own URL — the duplicate control principle 8 forbids — so the
    // palette answers "close the day" with a command carrying an anchor
    // instead, and this registry holds nothing for it.
    expect(STAFF_DESTINATIONS.some((destination) => destination.suffix === "/close-out")).toBe(
      false,
    );
    const orders = STAFF_DESTINATIONS.find((destination) => destination.id === "orders");
    expect(orders?.navGroup).toBe("daily");
    expect(orders?.inPalette).toBe(true);
  });

  it("offers the palette everything in the nav, plus the nav-free surfaces", () => {
    // Walk-in and Add-a-booking are palette-only; everything in the nav is
    // also in the palette.
    const palette = staffPaletteDestinations(owner).map((d) => d.id);
    expect(palette).toContain("walkIn");
    expect(palette).toContain("addBooking");
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
    // `/trips` only: Staffing has its own "Run the shop" row now, and a page
    // with a row of its own lights that row, never a borrowed tab.
    expect(board?.alsoMatch).toEqual(["/trips"]);
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

  it("keeps no Not-ready entry now that the home is the day spine", () => {
    // It was a page, then a view of Today, and it is now neither: a diver who
    // cannot board is a row on the station of the boat waiting for them (ADR
    // 20260827-clearwater-surface-language, decision 4). Today carries the
    // blocked badge, and there is one row in the palette for one URL.
    expect(STAFF_DESTINATIONS.some((destination) => destination.id === ("blockers" as never))).toBe(
      false,
    );
    const today = STAFF_DESTINATIONS.find((destination) => destination.id === "today");
    expect(staffDestinationHref(staffShopRoot("blue-mantis"), today ?? ({} as never))).toBe(
      "/shop/blue-mantis",
    );
  });
});

/**
 * Every nav consumer — header tabs, phone dock, the More menu and the dock's
 * More sheet — answers "which row reads as current?" through this one
 * function, so at most one thing anywhere lights up, and it is the most
 * specific claim on the page being looked at.
 */
describe("currentStaffNavDestinationId", () => {
  const root = staffShopRoot("blue-mantis");
  const current = (pathname: string, gates: StaffDestinationGates = owner) =>
    currentStaffNavDestinationId(pathname, root, gates);

  it("lights Today only at the shop root", () => {
    expect(current(root)).toBe("today");
    // Today's href is the root, which must never claim the whole subtree —
    // every staff page starts with it.
    expect(current(`${root}/orders`)).toBe("orders");
  });

  it("lights a destination for its own subtree", () => {
    expect(current(`${root}/reviews`)).toBe("reviews");
    expect(current(`${root}/requests`)).toBe("requests");
    expect(current(`${root}/reports`)).toBe("reports");
    expect(current(`${root}/staffing`)).toBe("staffing");
  });

  it("gives the most specific claim the light: Team over Settings", () => {
    expect(current(`${root}/settings`)).toBe("settings");
    expect(current(`${root}/settings/team`)).toBe("team");
    expect(current(`${root}/settings/calendar`)).toBe("calendarFeed");
    // Any other settings sub-page still reads as Settings.
    expect(current(`${root}/settings/export`)).toBe("settings");
  });

  it("lights a borrowed claim only for a page with no row of its own", () => {
    // Trip details are the board's detail views (`alsoMatch`).
    expect(current(`${root}/trips/42`)).toBe("board");
    // The walk-in counter is a way into Check-in; its more specific path must
    // not steal the tab's light (navGroup: null entries never compete).
    expect(current(`${root}/check-in/walk-in`)).toBe("checkIn");
  });

  it("never lights a row the viewer cannot see", () => {
    // A crew member on a gated page (deep link, say) gets no false light —
    // the gated row is absent, and nothing else may claim the page.
    expect(current(`${root}/settings/team`, crew)).toBeNull();
    // But their own calendar feed, ungated, still lights.
    expect(current(`${root}/settings/calendar`, crew)).toBe("calendarFeed");
  });

  it("answers null off the registry's map", () => {
    expect(current(`${root}/nowhere`)).toBeNull();
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

  it("keeps its nav row and palette row for that role", () => {
    expect(staffNavDestinations("setup", crew).map((d) => d.id)).toContain("calendarFeed");
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("calendarFeed");
  });

  it("hides settings and everything filed beneath it from the daily crew", () => {
    const ids = visibleStaffDestinations(crew).map((destination) => destination.id);
    expect(ids).not.toContain("settings");
    expect(ids).not.toContain("team");
  });
});

describe("one destination by id", () => {
  it("resolves, and throws on an id the registry lost", () => {
    expect(staffDestination("checkIn").suffix).toBe("/check-in");
    expect(() => staffDestination("gone" as StaffDestinationId)).toThrow(/unregistered/);
  });
});
