// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { RAIL_ROW_CLASS } from "@/components/ui/rail";
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

/**
 * The rail and pane of ADR 20260827-clearwater-surface-language, decision 6.
 *
 * What is pinned here is the *rule*, never the drawing: that the map covers
 * every section and every door the hub has, that the two selection mechanisms
 * stay separate, that a door row says nothing at rest, and that the captions
 * the copy-restraint filter took out are gone from every locale rather than
 * merely unused in one.
 */

const HERE = dirname(fileURLToPath(import.meta.url));
const SETTINGS_DIR = join(HERE, "..");
const LOCALES = join(HERE, "..", "..", "..", "..", "..", "i18n", "locales");
/** The stylesheet with its comments out, so a sentence about a rule is never read as the rule. */
const GLOBALS_CSS = readFileSync(join(HERE, "..", "..", "..", "..", "globals.css"), "utf8").replace(
  /\/\*[\s\S]*?\*\//g,
  "",
);

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

  it("keeps every fragment that other surfaces already link to", () => {
    // The pane scrolls; the ids do not move. These six are the anchors the
    // rest of the app spells out in `/settings#…` links, and a rename here
    // would be a dead deep link nothing else would notice.
    expect(settingsSectionFragment("contact")).toBe("contact");
    expect(settingsSectionFragment("profile")).toBe("profile");
    expect(settingsSectionFragment("units")).toBe("units");
    expect(settingsSectionFragment("reviewLink")).toBe("review-link");
    expect(settingsSectionFragment("searchListing")).toBe("search-listing");
    expect(settingsSectionFragment("conservation")).toBe("conservation");
  });
});

describe("the selection model", () => {
  it("selects a sub-route row by pathname, whatever the scroll-spy says", () => {
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/settings/team`,
        basePath: BASE,
        sectionId: "profile",
      }),
    ).toBe("team");
  });

  it("selects a hub section only when no route matches", () => {
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/settings`,
        basePath: BASE,
        sectionId: "tax",
      }),
    ).toBe("tax");
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

  it("gives the bare route the tie when two rows share a path", () => {
    // Backups and the download are one surface behind two doors
    // (`/settings/export#backups` and `/settings/export`). Standing on the
    // page is the bare row's fact.
    expect(
      currentSettingsRailRowId(SETTINGS_RAIL_ROWS, {
        pathname: `${BASE}/settings/export`,
        basePath: BASE,
      }),
    ).toBe("dataExport");
  });
});

describe("the rail as it renders", () => {
  it("is a desktop control and nothing else", () => {
    renderRail();
    // Below `lg` the phone keeps the grouped list; the rail must never stack
    // a directory above it, which is the sub-nav card this repo deleted once.
    expect(screen.getByRole("navigation", { name: "Settings sections" }).className).toContain(
      "hidden lg:block",
    );
  });

  it("holds its own width, so an absent rail costs the pane nothing", () => {
    // `/settings/calendar` is a staffer's own feed and takes no permission
    // gate, so an ordinary staffer reaches the settings frame while this rail
    // — drawn only for someone who may manage the shop — renders nothing
    // beside them. The frame is a flex row for that reader's sake: the rail
    // carries its own fixed width when it exists, rather than the frame
    // reserving a track that auto-places the pane into 264px when it does not.
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" }).className;
    expect(nav).toContain("lg:w-[264px]");
    expect(nav).toContain("lg:shrink-0");
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

  /**
   * **One page rail, one row.** The settings map and the long editor's section
   * rail are the same control, and they were two hand-rolled strings: settings
   * rows 36px tall at `px-2`, the editor's 44px at `px-3 py-2`. The rail shows
   * from `lg` up, which is a landscape tablet held in the hand, so the 44px
   * floor applies. Both rails draw `RAIL_ROW_CLASS`.
   */
  it("draws every row as the page rail's one row, at the 44px floor", () => {
    renderRail();
    const links = screen.getAllByRole("link");
    expect(links.length).toBeGreaterThan(0);
    for (const link of links) {
      expect(link).toHaveClass(...RAIL_ROW_CLASS.split(" "));
      expect(link).toHaveClass("min-h-11", "px-3", "py-2", "text-sm", "font-medium", "rounded-lg");
      expect(link).not.toHaveClass("h-9");
      expect(link).not.toHaveClass("px-2");
    }
  });

  it("starts each group label's words on the rows' text edge", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const group of SETTINGS_GROUPS) {
      const label = nav.querySelector(`#settings-rail-${group.id}`);
      const inset = [label, ...(label?.querySelectorAll("*") ?? [])].some((node) =>
        node?.classList.contains("px-3"),
      );
      expect(inset, `${group.id}'s label is not inset like its rows`).toBe(true);
    }
  });

  it("draws the focus ring inside each row", () => {
    // The rows sit flush with the left edge of the rail's own scroll box, which
    // cut the outset ring's left 5px on every one of them; and they are stacked
    // with no gap, so an outset ring would paint over its neighbours too.
    renderRail();
    for (const link of screen.getAllByRole("link")) {
      expect(link).toHaveClass("focus-visible:focus-ring-inset", "rounded-lg");
    }
  });

  it("spends no accent ink at all", () => {
    renderRail({ badges: { stripe: "Not connected" } });
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    expect(nav.innerHTML).not.toMatch(/accent/);
  });

  it("links a hub section by fragment and a sub-route by path", () => {
    renderRail();
    expect(screen.getByRole("link", { name: "tax" }).getAttribute("href")).toBe("#tax");
    expect(screen.getByRole("link", { name: "team" }).getAttribute("href")).toBe(
      `${BASE}/settings/team`,
    );
  });

  it("points a section link back at the hub from a sub-route", () => {
    pathname = `${BASE}/settings/team`;
    renderRail();
    expect(screen.getByRole("link", { name: "tax" }).getAttribute("href")).toBe(
      `${BASE}/settings#tax`,
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
    // The whole reason the rail exists: Money and Data & integrations are not
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

  /**
   * **Opaque only while rows slide under it.** At rest the rail's first label
   * sits on the staff page's water-band wash, and an always-opaque label
   * painted a flat grey slab (#f2f2f7) across the blue: the pixel probe
   * measured it 256×24 at y 149 on settings-address. The fill belongs to the
   * stuck state, which a scroll-state container query can see; a browser
   * without one keeps the opaque label, which is the safe way to be wrong.
   */
  it("lets the page's wash show through a label at rest", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    for (const group of SETTINGS_GROUPS) {
      const label = nav.querySelector(`#settings-rail-${group.id}`);
      expect(label).not.toHaveClass("bg-background");
      const words = label?.querySelector(":scope > span");
      expect(words?.textContent).toBe(group.id);
      expect(words).not.toHaveClass("bg-background");
    }
  });

  it("fills a label only while it is stuck, where the browser can tell", () => {
    const supports = GLOBALS_CSS.indexOf("@supports (container-type: scroll-state)");
    expect(supports).toBeGreaterThan(-1);
    const gated = GLOBALS_CSS.slice(supports);
    expect(gated).toMatch(/\.settings-rail-label\s*\{\s*container-type:\s*scroll-state;/);
    expect(gated).toMatch(
      /@container scroll-state\(stuck: top\)\s*\{\s*\.settings-rail-label > span\s*\{\s*background: var\(--rail-label-fill\);/,
    );
    // Outside the gate every label is filled, with the same fill.
    expect(GLOBALS_CSS.slice(0, supports)).toMatch(
      /\.settings-rail-label > span\s*\{\s*background: var\(--rail-label-fill\);/,
    );
  });

  /**
   * **The fill is the wash, never a flat ground.** The rail's box starts inside
   * the staff page's water-band wash, and the rail opens on the current row
   * (below), so on Boats, Print, Kinds of day, Seasons and WhatsApp a label is
   * stuck at the box's top the moment the page lands. A `var(--background)`
   * fill put the same 256×24 #f2f2f7 slab back across the blue there, 24px
   * higher than the one at rest. A filled label paints the band's own gradient,
   * shifted by how deep into the band the label sits, over the ground's colour
   * for wherever the band has run out.
   */
  it("fills a label with the page's own wash, at the label's depth in it", () => {
    const fill = GLOBALS_CSS.match(/--rail-label-fill:([^;]*);/)?.[1] ?? "";
    expect(fill).toContain("var(--background)");
    expect(fill).toContain("var(--water-wash");
    expect(fill).toContain("var(--rail-label-depth");
    expect(fill).toContain("var(--water-band-h");
    // One wash, two readers: the band paints the property it publishes.
    const band = GLOBALS_CSS.slice(GLOBALS_CSS.indexOf(".water-band {"));
    expect(band.slice(0, band.indexOf("}"))).toContain("background-image: var(--water-wash);");
    expect(GLOBALS_CSS).not.toMatch(
      /\.settings-rail-label > span\s*\{\s*background: var\(--background\);/,
    );
  });

  it("tints the label of the group the current row is in, and no other", () => {
    pathname = `${BASE}/settings/team`;
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    // "team" is a Your shop row; the other two groups stay quiet.
    expect(nav.querySelector("#settings-rail-your-shop")?.className).toContain("text-primary");
    expect(nav.querySelector("#settings-rail-money")?.className).not.toContain("text-primary");
    expect(nav.querySelector("#settings-rail-data-integrations")?.className).not.toContain(
      "text-primary",
    );
  });

  it("renders no badge at all when nothing is wrong", () => {
    // The calm state, which is nearly always: the map is words, not pills.
    const { container } = renderRail();
    expect(container.querySelectorAll("nav span.rounded-full")).toHaveLength(0);
  });

  /**
   * **A row's words wrap; they are never cut.** The rail is 264px by its
   * design (SPEC 6g, `lg:grid-cols-[264px_1fr]`), and the page rail's row
   * insets its words 12px a side, which left "Shopify, QuickBooks, Xero &
   * Zapier" 208px for 216px of words: truncated on every settings capture at
   * 1280. The row is a 44px floor, not a height, so a label that needs a
   * second line takes one.
   */
  it("wraps a long row's words onto a second line instead of cutting them off", () => {
    renderRail();
    for (const link of screen.getAllByRole("link")) {
      const words = link.querySelector(":scope > span");
      expect(words).toHaveClass("min-w-0", "text-pretty");
      expect(words).not.toHaveClass("truncate");
    }
  });

  /**
   * **A stuck label meets the box's top edge** (K-221). A sticky `top-0`
   * sticks at its scroller's padding edge, and the rail's scroller carried
   * `py-6`: a label stuck 24px under the box's top, and the rows scrolled past
   * it kept showing in that strip — once the rail opened on its current row,
   * a 10px sliver of "Trip packing checklist" stood above "YOUR SHOP" on Kinds
   * of day and Seasons. The inset belongs to what the box scrolls, not to the
   * box.
   */
  it("keeps its inset inside what it scrolls, so a stuck label sits on the box's top edge", () => {
    renderRail();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const scroller = nav.querySelector<HTMLElement>(".overflow-y-auto");
    if (!scroller) throw new Error("the rail has no scroll box");
    expect([...scroller.classList].filter((token) => /^p[tby]?-/.test(token))).toEqual([]);
    expect(scroller.firstElementChild).toHaveClass("py-6");
  });
});

/**
 * **The current row is on screen when the page opens.** The rail scrolls in a
 * box of its own, and the settings layout keeps it across a click inside the
 * rail, but every other way in (a direct link, ⌘K's "Go to", the hub's own
 * rows) landed with the box at its top: 19 grey rows and no selected one on
 * Kinds of day, Seasons, Print and WhatsApp, whose rows sit 140–750px below
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
    pathname = `${BASE}/settings/boats`;
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
   * under it: on Kinds of day and Seasons the bottom half of "Trip packing
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

/**
 * **A label knows how deep into the page's wash it sits.** The wash is the
 * shop layout's `.water-band` background, which scrolls with the page, while
 * the rail's box is sticky and scrolls on its own; no stylesheet can line a
 * label's fill up with a background on another element. So the rail measures
 * each label against the band, on landing and whenever the page or the rail
 * scrolls, and publishes it as `--rail-label-depth` for the fill to shift by.
 */
describe("the rail lines its labels' fill up with the page's wash", () => {
  function stubDepths(boxes: { band: number; labels: Record<string, number>; scroller: number }) {
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const at = (top: number, height: number) =>
        ({
          x: 0,
          y: top,
          top,
          left: 0,
          width: 256,
          height,
          bottom: top + height,
          right: 256,
        }) as DOMRect;
      if (this.classList.contains("water-band")) return at(boxes.band, 2000);
      if (this.classList.contains("overflow-y-auto")) return at(boxes.scroller, 744);
      const label = boxes.labels[this.id];
      if (label !== undefined) return at(label, 24);
      return at(0, 0);
    });
  }

  function renderInBand() {
    return render(<div className="water-band">{rail()}</div>);
  }

  function depth(groupId: string) {
    const label = document.getElementById(`settings-rail-${groupId}`);
    return label?.style.getPropertyValue("--rail-label-depth");
  }

  /** Frames the rail asked for, run when the test says the frame has come. */
  let frames: FrameRequestCallback[] = [];
  function nextFrame() {
    const due = frames;
    frames = [];
    for (const callback of due) callback(0);
  }

  beforeEach(() => {
    frames = [];
    vi.spyOn(window, "requestAnimationFrame").mockImplementation((callback) => {
      frames.push(callback);
      return frames.length;
    });
  });
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("publishes each label's depth into the band when the page lands", () => {
    // settings-boats@1280: the band starts under the bar and the demo banner,
    // the rail's box with it; the first label rests 24px down the box.
    stubDepths({
      band: 125,
      scroller: 125,
      labels: {
        "settings-rail-your-shop": 149,
        "settings-rail-money": 1180,
        "settings-rail-data-integrations": 1690,
      },
    });
    renderInBand();

    expect(depth("your-shop")).toBe("24px");
    expect(depth("money")).toBe("1055px");
    expect(depth("data-integrations")).toBe("1565px");
  });

  it("follows the page and the rail as either one scrolls", () => {
    const boxes = {
      band: 125,
      scroller: 125,
      labels: {
        "settings-rail-your-shop": 149,
        "settings-rail-money": 1180,
        "settings-rail-data-integrations": 1690,
      } as Record<string, number>,
    };
    stubDepths(boxes);
    renderInBand();
    const nav = screen.getByRole("navigation", { name: "Settings sections" });
    const scroller = nav.querySelector<HTMLElement>(".overflow-y-auto");
    if (!scroller) throw new Error("the rail has no scroll box");

    // The rail scrolls to Print: Money's label sticks at the box's top.
    boxes.labels["settings-rail-your-shop"] = -700;
    boxes.labels["settings-rail-money"] = 125;
    boxes.labels["settings-rail-data-integrations"] = 640;
    fireEvent.scroll(scroller);
    nextFrame();
    expect(depth("money")).toBe("0px");

    // The page scrolls 90px: the box pins under the bar, the band rises past it.
    boxes.band = 35;
    boxes.scroller = 56;
    boxes.labels["settings-rail-money"] = 56;
    fireEvent.scroll(window);
    nextFrame();
    expect(depth("money")).toBe("21px");
  });

  it("measures nothing on a page without a band, or while the rail is not drawn", () => {
    stubDepths({ band: 125, scroller: 125, labels: { "settings-rail-your-shop": 149 } });
    renderRail();
    expect(depth("your-shop")).toBe("");
    cleanup();

    // Below `lg` the rail is `hidden` and its box measures nothing.
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(
      () => ({ x: 0, y: 0, top: 0, left: 0, width: 0, height: 0, bottom: 0, right: 0 }) as DOMRect,
    );
    renderInBand();
    expect(depth("your-shop")).toBe("");
  });
});

describe("what the rail hides", () => {
  const gated: Record<string, SettingsRailGate> = {
    team: "team",
    waivers: "waivers",
    promos: "promos",
    whatsapp: "messaging",
    dataImport: "import",
    gearImport: "import",
    backup: "export",
    dataExport: "export",
    boats: "boats",
    stripe: "payments",
    tax: "payments",
  };

  it("drops every gated destination for a reader who holds nothing", () => {
    const rows = settingsRailRowsFor(new Set());
    const ids = new Set(rows.map((row) => row.id));
    for (const id of Object.keys(gated)) expect(ids.has(id)).toBe(false);
    // And keeps the ones nobody is gated out of, so an empty gate set is not
    // simply an empty rail.
    expect(ids.has("diveSites")).toBe(true);
    expect(ids.has("security")).toBe(true);
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
      <SettingsRow sectionId="tax" heading="Sales tax & VAT" description="What we charge on top.">
        <span>form</span>
      </SettingsRow>,
    );
    expect(screen.getByText("What we charge on top.")).toBeTruthy();
  });

  it("reopens the row `?saved=` named, and leaves the others shut", () => {
    const { container } = render(
      <>
        <SettingsRow sectionId="tax" activeSection="tax" heading="Sales tax & VAT">
          <span>tax form</span>
        </SettingsRow>
        <SettingsRow sectionId="units" activeSection="tax" heading="Units">
          <span>units form</span>
        </SettingsRow>
      </>,
    );
    const [tax, units] = [...container.querySelectorAll("details")];
    expect(tax?.open).toBe(true);
    expect(units?.open).toBe(false);
  });

  it("rings a setting's summary inside itself, rounded into the group's corners at the ends", () => {
    // Flush inside `InsetGroup`'s `overflow-hidden` card: the outset ring was
    // cut on both sides of every row (the probe's largest settings cluster).
    const { container } = render(
      <SettingsRow sectionId="tax" heading="Sales tax & VAT">
        <span>form</span>
      </SettingsRow>,
    );
    expect(container.querySelector("summary")).toHaveClass(
      "focus-visible:focus-ring-inset",
      "[details:first-child>&]:rounded-t-panel",
      "[details:last-child:not([open])>&]:rounded-b-panel",
    );
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

  /**
   * On a phone the summary is a column: the heading line, then the value.
   * A row with no value used to keep the value's wrapper anyway, holding only
   * the desktop caret, which is `hidden` there. The wrapper collapsed to 0px
   * and still took the column's 4px gap, so the pixel probe measured every
   * such label (Address, The counter card, Tax, …) 2px above its row's
   * centre on ten settings captures. Below `sm`, only boxes with something in
   * them may take part in the column.
   */
  it("keeps a row with no value to its heading line on a phone", () => {
    const { container } = render(
      <SettingsRow sectionId="address" heading="The counter card">
        <span>form</span>
      </SettingsRow>,
    );
    const summary = container.querySelector("summary");
    expect(summary?.querySelectorAll(":scope > :not(.hidden)")).toHaveLength(1);
  });

  it("stacks a row's value under its heading on a phone", () => {
    const { container } = render(
      <SettingsRow sectionId="address" heading="Address" value="12 Harbour Rd">
        <span>form</span>
      </SettingsRow>,
    );
    const summary = container.querySelector("summary");
    const shown = summary?.querySelectorAll(":scope > :not(.hidden)");
    expect(shown).toHaveLength(2);
    expect(shown?.[1]).toHaveTextContent("12 Harbour Rd");
  });
});

describe("the frame", () => {
  const layout = readFileSync(join(SETTINGS_DIR, "layout.tsx"), "utf8");

  it("splits into a rail and a pane from lg up, without reserving a track for one", () => {
    // A flex row rather than a two-track grid. `/settings/calendar` is a
    // staffer's own feed and takes no permission gate, so an ordinary staffer
    // reaches this frame while the rail beside it renders nothing — and under
    // `grid-cols-[264px_1fr]` their pane was auto-placed into the *first*
    // track, 264px wide with an empty column beside it. Flex has no track to
    // fall into: the rail carries its own width, and its absence gives the
    // pane the row.
    expect(layout).toContain("lg:flex");
    expect(layout).not.toContain("lg:grid-cols-");
    expect(layout).toContain("lg:flex-1");
  });

  it("awaits nothing above its children", () => {
    // A request-scoped read in a layout costs every route beneath it its
    // static shell (ADR 20260804-instant-navigation), so the rail's session
    // and permission reads live in an async child inside `<Suspense>`.
    expect(layout).toMatch(/export default function SettingsLayout/);
    expect(layout).toContain("<Suspense");
  });
});

describe("the captions the copy-restraint filter deleted", () => {
  const DELETED = [
    "team",
    "diveSites",
    "waivers",
    "safetyChecklist",
    "security",
    "promos",
    "embed",
    "calendar",
    "integrations",
    "whatsapp",
    "backup",
  ];

  for (const locale of ["en-US", "es-ES"]) {
    it(`leaves no door caption behind in ${locale}`, () => {
      // Three edits per key, and this is the one that catches the missing
      // third: a caption deleted from the call site and one locale, still
      // sitting in the other.
      const bundle = JSON.parse(
        readFileSync(join(LOCALES, locale, "staff", "settings.json"), "utf8"),
      ) as { main: Record<string, Record<string, string> | undefined> };
      for (const key of DELETED) {
        expect(bundle.main[key], `${locale}: settings.main.${key} is gone entirely`).toBeTruthy();
        expect(
          bundle.main[key]?.description,
          `${locale}: settings.main.${key}.description survived`,
        ).toBeUndefined();
      }
      for (const key of ["dataImport", "gearImport", "dataExport"]) {
        expect(bundle.main[key], `${locale}: settings.main.${key} survived`).toBeUndefined();
      }
    });
  }
});
