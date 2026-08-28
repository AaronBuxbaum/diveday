// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
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

function renderRail(
  options: { rows?: readonly SettingsRailRow[]; badges?: Record<string, string> } = {},
) {
  const rows = options.rows ?? SETTINGS_RAIL_ROWS;
  return render(
    <SettingsRail
      groups={railGroups(rows)}
      labels={Object.fromEntries(rows.map((row) => [row.id, row.id]))}
      badges={options.badges}
      shopBasePath={BASE}
      ariaLabel="Settings sections"
    />,
  );
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
    // 36px, the settings ramp's row height, with the primary tint carrying
    // selection — never the accent (ADR decision 11's coral budget has no row
    // for a settings surface).
    expect(selected[0]?.className).toContain("h-9");
    expect(selected[0]?.className).toContain("text-sm font-medium");
    expect(selected[0]?.className).toContain("bg-primary-tint text-primary");
    expect(selected[0]?.className).toContain("rounded-lg");
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

  it("renders no badge at all when nothing is wrong", () => {
    // The calm state, which is nearly always: the map is words, not pills.
    const { container } = renderRail();
    expect(container.querySelectorAll("nav span.rounded-full")).toHaveLength(0);
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
