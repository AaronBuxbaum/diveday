// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  currentSettingsRailRowId,
  SECTION_IDS,
  SETTINGS_GROUPS,
  SETTINGS_RAIL_ROWS,
  type SettingsRailGate,
  type SettingsRailRow,
  settingsRailRowsFor,
  settingsSectionFragment,
} from "../settings-groups";
import { SettingsRail } from "./SettingsRail";
import { SettingsDoorRow, SettingsRow } from "./SettingsRows";
import { SettingsSelection } from "./SettingsSelection";

/**
 * The rail and pane of ADR 20260827-clearwater-surface-language, decision 6.
 *
 * What is pinned here is the *rule*, never the drawing: that the map covers
 * every section and every door the hub has, that the two selection mechanisms
 * stay separate, that a door row says nothing at rest, and that the captions
 * the copy-restraint filter took out are gone from every locale rather than
 * merely unused in one.
 */

let pathname = "/shop/blue-mantis/settings";
vi.mock("next/navigation", () => ({ usePathname: () => pathname }));

afterEach(cleanup);

const BASE = "/shop/blue-mantis";

// Reset between cases rather than at the foot of the one that moves it: a
// failing assertion would otherwise leak its pathname into every test below.
beforeEach(() => {
  pathname = `${BASE}/settings`;
});

function railGroups(rows: readonly SettingsRailRow[] = SETTINGS_RAIL_ROWS) {
  return SETTINGS_GROUPS.map((group) => ({
    id: group.id,
    label: group.id,
    rows: rows.filter((row) => row.group === group.id),
  })).filter((group) => group.rows.length > 0);
}

type RailOptions = { rows?: readonly SettingsRailRow[]; badges?: Record<string, string> };

function rail(options: RailOptions = {}) {
  const rows = options.rows ?? SETTINGS_RAIL_ROWS;
  return (
    <SettingsRail
      groups={railGroups(rows)}
      labels={Object.fromEntries(rows.map((row) => [row.id, row.id]))}
      badges={options.badges}
      shopBasePath={BASE}
      ariaLabel="Settings sections"
    />
  );
}

function renderRail(options: RailOptions = {}) {
  return render(rail(options));
}

describe("the map covers the whole hub", () => {
  it("has one rail row for every section id — no orphan section", () => {
    const targeted = SETTINGS_RAIL_ROWS.flatMap((row) =>
      row.target.kind === "section" ? [row.target.id] : [],
    );
    // Sorted rather than ordered: the pane's order is asserted separately, by
    // the hub's own test reading the rows it renders.
    expect([...targeted].sort()).toEqual([...SECTION_IDS].sort());
  });

  it("gives every row a unique id and a group that exists", () => {
    const ids = SETTINGS_RAIL_ROWS.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    const groups = new Set<string>(SETTINGS_GROUPS.map((group) => group.id));
    for (const row of SETTINGS_RAIL_ROWS) expect(groups.has(row.group)).toBe(true);
  });

  it("never names a group what a section already answers to", () => {
    // A group's heading and a section's row are both `id`s on the one page, so
    // a shared name is a duplicate id: axe refuses it, and `#rentals` would
    // land on whichever came first. The Rentals group once was exactly that.
    const fragments = new Set<string>(SECTION_IDS.map((id) => settingsSectionFragment(id)));
    for (const group of SETTINGS_GROUPS) expect(fragments.has(group.id), group.id).toBe(false);
  });

  it("keeps every fragment that other surfaces already link to", () => {
    // The pane scrolls; the ids do not move. These four are the anchors the
    // rest of the app spells out in `/settings#…` links, and a rename here
    // would be a dead deep link nothing else would notice.
    expect(settingsSectionFragment("contact")).toBe("contact");
    expect(settingsSectionFragment("units")).toBe("units");
    expect(settingsSectionFragment("reviewLink")).toBe("review-link");
    expect(settingsSectionFragment("searchListing")).toBe("search-listing");
  });
});

describe("the selection model", () => {
  it("selects a sub-route row by pathname, whatever the scroll-spy says", () => {
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/settings/team`,
        basePath: BASE,
        sectionId: "contact",
      }),
    ).toBe("team");
  });

  it("selects a hub section only when no route matches", () => {
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/settings`,
        basePath: BASE,
        sectionId: "stripe",
      }),
    ).toBe("stripe");
  });

  it("selects nothing when the scroll-spy has not answered yet", () => {
    // The silence the design depends on: no row lights up on a page the rail
    // has no claim over, rather than the first row lighting by default.
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/orders`,
        basePath: BASE,
        sectionId: null,
      }),
    ).toBeNull();
  });

  it("lights Your data on any of its four tabs", () => {
    // Export, Backups, Import and Integrations are one rail row (issue #2813):
    // standing on any of the four pages is standing on it.
    for (const path of [
      "/settings/export",
      "/settings/export/backups",
      "/settings/import",
      "/settings/integrations",
    ]) {
      expect(
        currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
          pathname: `${BASE}${path}`,
          basePath: BASE,
        }),
        path,
      ).toBe("yourData");
    }
  });
});

describe("the rail as it renders", () => {
  it("names the current section and dismisses the mobile picker with Escape or an outside tap", () => {
    pathname = `${BASE}/settings/import`;
    renderRail();
    const toggle = screen.getByRole("button", { name: "Settings sections" });
    expect(toggle).toHaveTextContent("yourData");
    fireEvent.click(toggle);
    expect(screen.getByRole("link", { name: "yourData" })).toHaveFocus();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(toggle).toHaveFocus();
    fireEvent.click(toggle);
    fireEvent.pointerDown(document.body);
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  it("opens and closes the same navigation on a narrow screen", () => {
    const { container } = renderRail();
    const toggle = screen.getByRole("button", { name: "Settings sections" });
    const scroller = container.querySelector("[data-settings-rail-scroller]");
    expect(toggle).toHaveAttribute("aria-expanded", "false");
    expect(scroller).toHaveClass("hidden");
    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute("aria-expanded", "true");
    expect(scroller).not.toHaveClass("hidden");
    fireEvent.click(screen.getByRole("link", { name: "stripe" }));
    expect(toggle).toHaveAttribute("aria-expanded", "false");
  });

  /**
   * The rail moves to the current row from an effect, after the page paints,
   * so a screenshot fired early caught it at the top (`settings-embed` moved
   * between two runs that never touched Settings). The mark is what the visual
   * suite waits on, so it has to arrive once the move has run.
   */
  it("updates the persistent rail when a form returns to another saved section", () => {
    const tree = (saved: "units" | null) => (
      <>
        {rail()}
        <SettingsSelection initialSection={saved}>
          <div data-settings-group="shop">
            <div data-settings-section="timezone">
              <details>
                <summary>Timezone form</summary>
              </details>
            </div>
            <div data-settings-section="units">
              <details>
                <summary>Units form</summary>
              </details>
            </div>
          </div>
        </SettingsSelection>
      </>
    );
    const { rerender } = render(tree(null));
    expect(screen.getByRole("link", { name: "timezone" })).toHaveAttribute("aria-current", "true");
    rerender(tree("units"));
    expect(screen.getByRole("link", { name: "units" })).toHaveAttribute("aria-current", "true");
  });

  it("marks its scroll box settled once it has moved to the current row", () => {
    pathname = `${BASE}/settings/embed`;
    const { container } = renderRail();
    const box = container.querySelector("[data-settings-rail-scroller]");
    expect(box?.hasAttribute("data-rail-settled")).toBe(true);
  });

  it("marks the current row, and only that one", () => {
    pathname = `${BASE}/settings/team`;
    renderRail();
    const selected = screen
      .getAllByRole("link")
      .filter((link) => link.getAttribute("aria-current") === "true");
    expect(selected).toHaveLength(1);
    expect(selected[0]?.textContent).toBe("team");
    // The primary tint carries selection — never the accent (ADR decision
    // 11's coral budget has no row for a settings surface).
    expect(selected[0]).toHaveClass("bg-primary-tint", "text-primary");
  });

  it("links a hub section by fragment and a sub-route by path", () => {
    renderRail();
    expect(screen.getByRole("link", { name: "stripe" }).getAttribute("href")).toBe("#stripe");
    expect(screen.getByRole("link", { name: "team" }).getAttribute("href")).toBe(
      `${BASE}/settings/team`,
    );
  });

  it("ends a row that opens its own page in the door's chevron, and only that row", () => {
    // Aaron, 2026-10-03: the rail should say which rows open a new page. A
    // sub-route row wears the door glyph every other door wears; a hub section
    // scrolls in place and carries nothing.
    renderRail();
    const chevron = (name: string) =>
      screen.getByRole("link", { name }).querySelector("svg[aria-hidden='true']");
    expect(chevron("team")).not.toBeNull();
    expect(chevron("boats")).not.toBeNull();
    expect(chevron("stripe")).toBeNull();
    expect(chevron("timezone")).toBeNull();
  });

  it("points a section link back at the hub from a sub-route", () => {
    pathname = `${BASE}/settings/team`;
    renderRail();
    expect(screen.getByRole("link", { name: "stripe" }).getAttribute("href")).toBe(
      `${BASE}/settings#stripe`,
    );
  });

  it("carries at most one badge, and only when a summary reader warns", () => {
    const { container } = renderRail({ badges: { stripe: "Not connected" } });
    const badges = container.querySelectorAll("nav span.rounded-full");
    expect(badges).toHaveLength(1);
    expect(badges[0]?.className).toContain("bg-warning-tint");
    expect(badges[0]?.textContent).toBe("Not connected");
  });

  it("draws every group, each under its own label", () => {
    // The whole reason the rail exists: the groups below the first are not
    // a second page. A regression that dropped them would still look right on
    // the hub, where the pane repeats the map below the fold.
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const group of SETTINGS_GROUPS) {
      const label = nav.querySelector(`#settings-rail-${group.id}`);
      expect(label, `${group.id} has no label on the rail`).toBeTruthy();
      // Sticky inside the rail's own scroll area: 42 rows do not fit beside a
      // bar on any viewport, so the group being read has to stay named at the
      // top of the column.
      expect(label).toHaveClass("sticky", "top-0", "settings-rail-label");
    }
    expect(nav.querySelectorAll("ul")).toHaveLength(SETTINGS_GROUPS.length);
  });

  it("renders no badge at all when nothing is wrong", () => {
    // The calm state, which is nearly always: the map is words, not pills.
    const { container } = renderRail();
    expect(container.querySelectorAll("nav span.rounded-full")).toHaveLength(0);
  });
});

/**
 * **The current row is on screen when the page opens.** The rail scrolls in a
 * box of its own, and the settings layout keeps it across a click inside the
 * rail, but every other way in (a direct link, ⌘K's "Go to", the hub's own
 * rows) landed with the box at its top: 19 grey rows and no selected one on
 * Trip tags, Print and WhatsApp, whose rows sit 140–750px below
 * the box's fold. The rail brings its own box to the row, and never the page:
 * `scrollIntoView` would scroll the window as well.
 */
describe("the rail keeps the current row in view", () => {
  type Box = { top: number; height: number };
  type Boxes = { scroller: Box; row: Box; label: Box };

  /** Measures read from `boxes` at call time, so a test can move a row. */
  function stubBoxes(boxes: Boxes) {
    const rect = ({ top, height }: Box) =>
      ({
        x: 88,
        y: top,
        top,
        left: 88,
        width: 256,
        height,
        bottom: top + height,
        right: 344,
        toJSON: () => ({}),
      }) as DOMRect;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      if (this.getAttribute("aria-current") === "true") return rect(boxes.row);
      if (this.classList.contains("overflow-y-auto")) return rect(boxes.scroller);
      if (this.classList.contains("settings-rail-label")) return rect(boxes.label);
      return rect({ top: 0, height: 0 });
    });
  }

  function railScroller() {
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const scroller = nav.querySelector<HTMLElement>(".overflow-y-auto");
    if (!scroller) throw new Error("the rail has no scroll box");
    return scroller;
  }

  const scrollIntoView = vi.fn();
  beforeEach(() => {
    Element.prototype.scrollIntoView = scrollIntoView;
    scrollIntoView.mockClear();
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("scrolls its own box, never the page, to a current row below the fold", () => {
    pathname = `${BASE}/settings/team`;
    const scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => {});
    // The box is 744px tall under the bar; the row sits 1,500px down its list.
    stubBoxes({
      scroller: { top: 56, height: 744 },
      row: { top: 1500, height: 44 },
      label: { top: 80, height: 24 },
    });
    renderRail();

    // The row's centre on the box's centre: 1,522 − (56 + 372).
    expect(railScroller().scrollTop).toBe(1094);
    expect(scrollTo).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("leaves the box where it is when the current row is already in view", () => {
    // A click inside the rail keeps the reader's place.
    pathname = `${BASE}/settings/team`;
    stubBoxes({
      scroller: { top: 56, height: 744 },
      row: { top: 400, height: 44 },
      label: { top: 80, height: 24 },
    });
    renderRail();

    expect(railScroller().scrollTop).toBe(0);
  });

  it("treats a current row in the faded foot as out of sight", () => {
    // "Calendar subscriptions" sat in the last 3rem of the box while rows
    // went on below, and the fade washed it out to nearly nothing.
    pathname = `${BASE}/settings/team`;
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockReturnValue(2000);
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockReturnValue(744);
    stubBoxes({
      scroller: { top: 56, height: 744 },
      row: { top: 740, height: 44 },
      label: { top: 80, height: 24 },
    });
    renderRail();

    // Centred: 762 − (56 + 372).
    expect(railScroller().scrollTop).toBe(334);
  });

  it("brings the row a reader went to out from under its group's stuck label", () => {
    pathname = `${BASE}/settings/team`;
    const boxes: Boxes = {
      scroller: { top: 56, height: 744 },
      row: { top: 400, height: 44 },
      label: { top: 80, height: 24 },
    };
    stubBoxes(boxes);
    const { rerender } = renderRail();
    const scroller = railScroller();
    scroller.scrollTop = 600;

    // ⌘K "Go to" Boats: its row is under the stuck label at the box's top.
    pathname = `${BASE}/boats`;
    boxes.row = { top: 60, height: 44 };
    boxes.label = { top: 56, height: 24 };
    rerender(rail());

    // Centred from where the reader left it: 600 + (82 − 428).
    expect(scroller.scrollTop).toBe(254);
  });

  /**
   * **It lands a whole row under the stuck label, never half of one** (K-221).
   * Centring the row put the box's scroll wherever the arithmetic fell, and
   * the label stuck at the box's top cut the row that happened to be passing
   * under it: on Trip tags the bottom half of "Trip packing
   * checklist" showed under "YOUR SHOP", a state only a hand could have left
   * the rail in. The rail finishes the move on a row's edge: the first row
   * the label would cut starts where a row starts under its label at rest.
   */
  it("lands a whole row under the label stuck at the box's top", () => {
    // The deepest sub-route on the map, far below the box's fold.
    const deepest = railGroups()
      .flatMap((group) => group.rows)
      .filter((row) => row.target.kind === "route" && row.target.path.startsWith("/settings/"))
      .at(-1);
    if (deepest?.target.kind !== "route") throw new Error("no sub-route row");
    pathname = `${BASE}${deepest.target.path}`;
    const BOX = { top: 56, height: 744 };
    const LABEL_H = 28;
    const FIRST_ROW = 60; // the first row's top in the box's content, under its label
    const ROW_H = 44;
    const scroller = () => railScroller();
    const rect = (top: number, height: number) =>
      ({
        x: 88,
        y: top,
        top,
        left: 88,
        width: 256,
        height,
        bottom: top + height,
        right: 344,
        toJSON: () => ({}),
      }) as DOMRect;
    // One group's worth of layout, read at call time so it follows scrollTop:
    // rows 44px apart, and the group's label stuck at the box's top once the
    // box has scrolled past where it rests.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const box = scroller();
      const scrolled = box.scrollTop;
      if (this === box) return rect(BOX.top, BOX.height);
      if (this.classList.contains("settings-rail-label")) {
        const rest = BOX.top + 24 - scrolled;
        return rect(Math.max(BOX.top, rest), LABEL_H);
      }
      const li = this.closest("li");
      if (li && box.contains(li)) {
        const index = [...box.querySelectorAll("li")].indexOf(li);
        return rect(BOX.top + FIRST_ROW + index * ROW_H - scrolled, ROW_H);
      }
      return rect(0, 0);
    });
    renderRail();

    const top = scroller().scrollTop;
    expect(top, "the box never moved").toBeGreaterThan(0);
    const labelBottom = BOX.top + LABEL_H;
    const rows = [...scroller().querySelectorAll("li")].map((li) => li.getBoundingClientRect());
    const cut = rows.find((row) => row.bottom > labelBottom);
    expect(cut?.top, "a row stands half under the stuck label").toBeGreaterThanOrEqual(labelBottom);
    // And the row the reader came for is still in the box.
    const current = scroller().querySelector<HTMLElement>('[aria-current="true"]');
    const at = current?.getBoundingClientRect();
    expect(at && at.top >= labelBottom && at.bottom <= BOX.top + BOX.height).toBe(true);
  });

  it("does nothing while the rail is not drawn", () => {
    // Below `lg` the rail is `hidden`, and every box measures zero.
    pathname = `${BASE}/settings/team`;
    stubBoxes({
      scroller: { top: 0, height: 0 },
      row: { top: 0, height: 0 },
      label: { top: 0, height: 0 },
    });
    renderRail();

    expect(railScroller().scrollTop).toBe(0);
  });
});

describe("the rail says there is more below", () => {
  /** The box's measures, read at call time so a test can scroll it. */
  function stubScroll(box: { scrollHeight: number; clientHeight: number }) {
    vi.spyOn(HTMLElement.prototype, "scrollHeight", "get").mockImplementation(
      () => box.scrollHeight,
    );
    vi.spyOn(HTMLElement.prototype, "clientHeight", "get").mockImplementation(
      () => box.clientHeight,
    );
  }
  afterEach(() => {
    vi.restoreAllMocks();
  });

  function scroller(container: HTMLElement) {
    const box = container.querySelector<HTMLElement>("[data-settings-rail-scroller]");
    if (!box) throw new Error("the rail has no scroll box");
    return box;
  }

  it("fades its foot while rows run past the bottom, and clears it at the end", () => {
    stubScroll({ scrollHeight: 2220, clientHeight: 744 });
    const { container } = renderRail();
    const box = scroller(container);
    expect(box.hasAttribute("data-more-below")).toBe(true);

    box.scrollTop = 2220 - 744;
    fireEvent.scroll(box);
    expect(box.hasAttribute("data-more-below")).toBe(false);
  });

  it("draws no fade when every row already fits", () => {
    stubScroll({ scrollHeight: 600, clientHeight: 744 });
    const { container } = renderRail();
    expect(scroller(container).hasAttribute("data-more-below")).toBe(false);
  });
});

describe("what the rail hides", () => {
  const gated: Record<string, SettingsRailGate> = {
    team: "team",
    waivers: "waivers",
    whatsapp: "messaging",
    boats: "boats",
    stripe: "payments",
    billing: "billing",
    counterCard: "selfRegistration",
  };

  it("drops every gated destination for a reader who holds nothing", () => {
    const rows = settingsRailRowsFor(new Set());
    const ids = new Set(rows.map((row) => row.id));
    for (const id of Object.keys(gated)) expect(ids.has(id)).toBe(false);
    // And keeps the ones nobody is gated out of, so an empty gate set is not
    // simply an empty rail.
    expect(ids.has("diveSites")).toBe(true);
    expect(ids.has("yourData")).toBe(true);
  });

  it("carries the gate the hub carries, row by row", () => {
    const byId = new Map(SETTINGS_RAIL_ROWS.map((row) => [row.id, row]));
    for (const [id, gate] of Object.entries(gated)) expect(byId.get(id)?.gate).toBe(gate);
  });

  it("renders no link to a destination it dropped", () => {
    renderRail({ rows: settingsRailRowsFor(new Set()) });
    expect(screen.queryByRole("link", { name: "team" })).toBeNull();
    expect(screen.queryByRole("link", { name: "stripe" })).toBeNull();
  });
});

describe("the rows the pane is made of", () => {
  it("gives a door row its name and nothing else", () => {
    // The standing caption is gone (decision 6): the row is its label, and the
    // page it opens is where the explanation lives.
    const { container } = render(<SettingsDoorRow href={`${BASE}/settings/team`} heading="Team" />);
    expect(screen.getByRole("link", { name: "Team" })).toBeTruthy();
    expect(container.querySelectorAll("p")).toHaveLength(0);
  });

  it("still explains inside an opened setting", () => {
    render(
      <SettingsRow
        sectionId="stripe"
        heading="Sales tax & VAT"
        description="What we charge on top."
      >
        <span>form</span>
      </SettingsRow>,
    );
    expect(screen.getByText("What we charge on top.")).toBeTruthy();
  });

  it("reopens the row `?saved=` named, and leaves the others shut", () => {
    const { container } = render(
      <>
        <SettingsRow sectionId="stripe" activeSection="stripe" heading="Sales tax & VAT">
          <span>tax form</span>
        </SettingsRow>
        <SettingsRow sectionId="units" activeSection="stripe" heading="Units">
          <span>units form</span>
        </SettingsRow>
      </>,
    );
    const [tax, units] = [...container.querySelectorAll("details")];
    expect(tax?.open).toBe(true);
    expect(units?.open).toBe(false);
  });

  it("puts the fragment target inside the disclosure, where the reveal reaches it", () => {
    const { container } = render(
      <SettingsRow sectionId="reviewLink" heading="Review link">
        <span>form</span>
      </SettingsRow>,
    );
    const anchor = container.querySelector("#review-link");
    expect(anchor).toBeTruthy();
    expect(anchor?.closest("details")).toBeTruthy();
  });
});
