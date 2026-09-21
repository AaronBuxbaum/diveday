import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  currentStaffDestination,
  currentStaffPlace,
  isLiveManifestPath,
  STAFF_DESTINATION_LABEL_KEYS,
  STAFF_DESTINATION_TITLE_KEYS,
  STAFF_DESTINATIONS,
  type StaffDestinationGates,
  type StaffDestinationId,
  staffBarPlaces,
  staffDestination,
  staffDestinationHref,
  staffDestinationSuffix,
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

  it("keeps every destination reachable through the search", () => {
    // The bar wears three times and never a list of destinations, so the
    // search is what everything else is reached by — and it is a control in
    // the bar at every width, not a keyboard shortcut (slice 23b; ADR
    // 20260813-more-is-the-shops-other-door on why that distinction matters).
    // A destination the search does not offer is a page with no door.
    for (const destination of STAFF_DESTINATIONS) {
      expect(destination.inPalette, `${destination.id} has no door`).toBe(true);
    }
  });

  it("gives every destination a time it happens at", () => {
    // `navGroup` allowed `null` — "real, but the header has no room". A place
    // is not a slot, so there is nothing to be left out of.
    for (const destination of STAFF_DESTINATIONS) {
      expect(["day", "week", "season", "shop"], destination.id).toContain(destination.place);
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

describe("the live manifest route", () => {
  const root = staffShopRoot("blue-mantis");

  it("matches only this shop's live manifest surface", () => {
    expect(isLiveManifestPath(`${root}/trips/42/manifest`, root)).toBe(true);
    expect(isLiveManifestPath(`${root}/trips/42/manifest/?checkpoint=departure`, root)).toBe(true);
    expect(isLiveManifestPath(`${root}/trips/42/manifest/`, root)).toBe(true);

    expect(isLiveManifestPath("/offline-manifest?trip=42", root)).toBe(false);
    expect(isLiveManifestPath(`${root}/trips/42`, root)).toBe(false);
    expect(isLiveManifestPath(`${root}/trips/42/manifest/extra`, root)).toBe(false);
    expect(isLiveManifestPath(`/shop/blue-mantis-north/trips/42/manifest`, root)).toBe(false);
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
    // Neither the inbox nor Requests is on this list, and that pairing is the
    // point. The inbox's gate went on 2026-09-10 (issues #1505/#1518) and
    // Requests' on 2026-09-16 (issue #1679), both as H-14 amendments and both
    // *deleted* rather than relaxed. The reason Requests carried one — a pile
    // of contact details for people who have not booked — stopped
    // distinguishing it the day the inbox began showing a stranger's address
    // and message to every live staff role.
    expect(gated).toEqual(["waivers", "reports", "team", "promoCodes", "settings"]);

    const visible = visibleStaffDestinations(crew).map((destination) => destination.id);
    // The two consumers the registry has left: the bar's three times, and the
    // search. It used to be three — the header strip, the dock and the More
    // surfaces all derived their own rows, and this test walked all of them.
    const palette = staffPaletteDestinations(crew).map((destination) => destination.id);
    const bar = staffBarPlaces(crew).map((entry) => entry.destination.id);

    for (const id of gated) {
      expect(visible).not.toContain(id);
      expect(palette).not.toContain(id);
      expect(bar).not.toContain(id);
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

  it("never renders an empty bar: the barest crew role still gets a Today and a Week", () => {
    // Season is `reports`, which is gated, so a captain's bar is two pills —
    // the honest picture rather than a pill that refuses. Today and the board
    // are ungated and always there.
    expect(staffBarPlaces(crew).map((entry) => entry.place)).toEqual(["day", "week"]);
    expect(staffBarPlaces(owner).map((entry) => entry.place)).toEqual(["day", "week", "season"]);
  });
});

describe("what each consumer derives", () => {
  it("wears three times, and each one points at a real destination", () => {
    // Today, Week and Season — what the desk bar is drawn with on
    // `Tide.dc.html`. Not a smaller nav of nouns: the pages behind them may be
    // rebuilt (the board becomes the week in 23f) without the bar changing.
    expect(staffBarPlaces(owner).map((entry) => entry.destination.id)).toEqual([
      "today",
      "board",
      "reports",
    ]);
    // And each is the destination whose own place it is, so a pill can never
    // point at a page filed under a different time.
    for (const { place, destination } of staffBarPlaces(owner)) {
      expect(destination.place, destination.id).toBe(place);
    }
  });

  it("files every destination under the time it happens at", () => {
    const byPlace = (place: string) =>
      visibleStaffDestinations(owner)
        .filter((destination) => destination.place === place)
        .map((destination) => destination.id);
    // What is happening now, what is coming, what the days added up to, and
    // the one with no hour at all.
    expect(byPlace("day")).toEqual([
      "today",
      "checkIn",
      "divers",
      "addBooking",
      "walkIn",
      "tookACall",
      "gear",
      "inbox",
    ]);
    expect(byPlace("week")).toEqual(["board", "staffing", "courses", "requests"]);
    expect(byPlace("season")).toEqual(["reviews", "orders", "reports"]);
    expect(byPlace("shop")).toEqual([
      "diveSites",
      "waivers",
      "team",
      "promoCodes",
      "calendarFeed",
      "settings",
    ]);
  });

  /**
   * The widening of 2026-09-10 (issues #1505/#1518) read from the nav: Inbox
   * is a destination for the captain and the deckhand too, not only for the
   * desk. Asserted on its own rather than left to the gated-ids list
   * above, because that list would still pass if Inbox were dropped from the
   * registry outright.
   */
  it("gives the daily crew the Inbox too, not only owners", () => {
    expect(visibleStaffDestinations(crew).map((d) => d.id)).toContain("inbox");
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("inbox");
  });

  /**
   * And Requests beside it, since 2026-09-16 (issue #1679, the same H-14 row).
   * Asserted on its own for the same reason Inbox is: the gated-ids list above
   * would still pass if Requests were dropped from the registry outright.
   *
   * The pairing is the whole argument. While Requests was gated and the inbox
   * was not, a captain was refused a page of people who asked for a Tuesday and
   * admitted, one tab across, to a page of strangers' addresses and messages
   * they could answer in the shop's name — so the privacy reason written on
   * this gate had stopped describing where DiveDay draws its lines.
   */
  it("gives the daily crew Requests beside the Inbox", () => {
    expect(visibleStaffDestinations(crew).map((d) => d.id)).toContain("requests");
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("requests");
    // The one that is not a nav question: `/calls` is ungated and its
    // date-request outcome redirects here, so a captain who wrote a caller down
    // used to be sent straight into a refusal for the row they had just made.
    expect(visibleStaffDestinations(crew).map((d) => d.id)).toContain("requests");
  });

  it("keeps the acts on the day they happen on rather than nowhere", () => {
    // Seating a diver, the walk-in counter and the desk phone used to carry
    // `navGroup: null` — "an act, not a place a menu should list". They are
    // still acts; they just happen on the day, and saying so costs the bar
    // nothing because the bar lists no destinations at all.
    for (const id of ["addBooking", "walkIn", "tookACall"] as const) {
      expect(staffDestination(id).place, id).toBe("day");
    }
  });

  it("puts Settings last in the whole registry, so no consumer can list it mid-menu", () => {
    expect(STAFF_DESTINATIONS.at(-1)?.id).toBe("settings");
    expect(staffPaletteDestinations(owner).at(-1)?.id).toBe("settings");
  });

  it("has no Close-out destination at all, and files Orders under the season", () => {
    // The evening is a state the shop home settles into, not a place to go
    // (H-62). An entry pointing at the bare home would be a second row landing
    // on Today's own URL — the duplicate control principle 8 forbids — so the
    // palette answers "close the day" with a command carrying an anchor
    // instead, and this registry holds nothing for it.
    expect(STAFF_DESTINATIONS.some((destination) => destination.suffix === "/close-out")).toBe(
      false,
    );
    const orders = STAFF_DESTINATIONS.find((destination) => destination.id === "orders");
    expect(orders?.place).toBe("season");
    expect(orders?.inPalette).toBe(true);
  });

  it("offers the search every destination the registry has", () => {
    const palette = staffPaletteDestinations(owner).map((d) => d.id);
    for (const destination of STAFF_DESTINATIONS) {
      expect(palette, destination.id).toContain(destination.id);
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
    expect(addBooking.place).toBe("day");
    expect(addBooking.inPalette).toBe(true);
    expect(addBooking.gate).toBeUndefined();
    expect(staffDestinationHref(staffShopRoot("blue-mantis"), addBooking)).toBe(
      "/shop/blue-mantis/bookings/new",
    );
    // Seating a diver is front-desk work, not owner work, so the crew keeps it.
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("addBooking");
  });

  it("keeps a trip's detail page lit on the week the board is", () => {
    const board = STAFF_DESTINATIONS.find((destination) => destination.id === "board");
    expect(board?.suffix).toBe("/schedule/board");
    // `/trips` only: Staffing is its own `week` destination, and a page with a
    // destination of its own lights that, never a borrowed claim.
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
describe("currentStaffDestination and the time it lights", () => {
  const root = staffShopRoot("blue-mantis");
  const current = (pathname: string, gates: StaffDestinationGates = owner) =>
    currentStaffDestination(pathname, root, gates)?.id ?? null;
  const place = (pathname: string, gates: StaffDestinationGates = owner) =>
    currentStaffPlace(pathname, root, gates);

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

  it("lets the walk-in counter claim its own path, because the answer is the day either way", () => {
    // This used to be guarded: `navGroup: null` entries were skipped so the
    // counter's more specific path could not steal the Check-in *tab's* light,
    // back when those were two rows in a bar. Nothing is skipped now, so the
    // counter wins the claim — and Check-in and the counter are the same
    // place, so the bar lights Today for both. The guard protected a question
    // the bar no longer asks.
    expect(current(`${root}/check-in/walk-in`)).toBe("walkIn");
    expect(place(`${root}/check-in/walk-in`)).toBe("day");
    expect(place(`${root}/check-in`)).toBe("day");
  });

  it("lights a borrowed claim for a page with no destination of its own", () => {
    // Trip details are the board's detail views (`alsoMatch`), and the board
    // is the week.
    expect(current(`${root}/trips/42`)).toBe("board");
    expect(place(`${root}/trips/42`)).toBe("week");
  });

  it("never lights a destination the viewer cannot see", () => {
    // A crew member on a gated page (deep link, say) gets no false light —
    // the gated row is absent, and nothing else may claim the page.
    expect(current(`${root}/settings/team`, crew)).toBeNull();
    // But their own calendar feed, ungated, still lights.
    expect(current(`${root}/settings/calendar`, crew)).toBe("calendarFeed");
  });

  it("answers null off the registry's map", () => {
    expect(current(`${root}/nowhere`)).toBeNull();
    expect(place(`${root}/nowhere`)).toBeNull();
  });

  it("lights none of the bar's three for a page that lives behind the shop's name", () => {
    // The site library, the waiver template and Settings are `shop` — no
    // hour, and no pill. That is the design rather than a gap: each is
    // reached from the shop's own name at the other end of the bar, and by
    // search. `settings-doors.test.ts` holds the other half of that claim —
    // that Settings really does carry a door to every one of them.
    for (const suffix of ["/dive-sites", "/waivers", "/settings"]) {
      expect(place(`${root}${suffix}`), suffix).toBe("shop");
    }
  });

  it("lights Today for the gear register, which is a morning rather than a setting", () => {
    // The register was `shop` until #1937, on a mapping of the retired
    // `navGroup: "daily"` that inverted the row's own reason for being in
    // that group. Handing a wetsuit over and chasing it back is the day's
    // work, and Settings never had a door to the fleet — so the bar said
    // "behind the shop's name" about a page that was not there.
    expect(place(`${root}/gear`)).toBe("day");
    // The unit page too, which is where a staffer actually pulls one for
    // service: `destinationClaim` matches on the path prefix, and a reading
    // that lit the index and went dark one tap in would be worse than either.
    expect(place(`${root}/gear/some-unit-id`)).toBe("day");
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

  it("keeps its door in the search for that role", () => {
    expect(staffPaletteDestinations(crew).map((d) => d.id)).toContain("calendarFeed");
    // Filed behind the shop's name with the rest of the configuration, which
    // is where a personal feed of your own shifts belongs.
    expect(staffDestination("calendarFeed").place).toBe("shop");
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
