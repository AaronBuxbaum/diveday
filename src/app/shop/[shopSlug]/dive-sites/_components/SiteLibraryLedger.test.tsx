// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { SiteLibraryGroup } from "@/db/dive-sites";
import { diverTranslator } from "@/i18n/messages";
import { staffTranslator } from "@/i18n/staff-messages";
import { SiteLibraryLedger } from "./SiteLibraryLedger";

afterEach(cleanup);

const t = staffTranslator("en-US");
const diverT = diverTranslator("en-US");

type Site = SiteLibraryGroup["sites"][number];

/**
 * A library row with everything a site can leave unsaid left unsaid — the
 * ordinary state of a briefing nobody has finished. Each test names only the
 * one or two fields it is about.
 *
 * The groups are built here rather than through `groupSiteLibrary`: that
 * function lives beside the query it re-files, and importing it would drag
 * `src/db/client.ts` (PGlite, `pg`) into a jsdom render test for one pure
 * `Map`. Its own pin — easiest first, unrated last — is in
 * `src/db/dive-sites.test.ts`.
 */
function site(overrides: Partial<Site> = {}): Site {
  return {
    id: "site-1",
    shopId: "shop-1",
    name: "Molasses Reef",
    difficultyLevel: null,
    locationName: "Key Largo",
    depthRange: null,
    currentNote: null,
    fitTone: null,
    minimumCertificationLevel: null,
    requiredSpecialties: [],
    requiresNitrox: false,
    sourceTemplateId: null,
    sourceTemplateVersion: null,
    ...overrides,
  } as Site;
}

/** One group, the shape `groupSiteLibrary` hands the ledger. */
function group(label: SiteLibraryGroup["label"], ...sites: Site[]): SiteLibraryGroup {
  return { label, sites };
}

function renderLedger(
  groups: SiteLibraryGroup[],
  options: {
    catalog?: { href: string; count: number } | null;
    currentTemplateVersion?: Map<string, number>;
  } = {},
) {
  return render(
    <SiteLibraryLedger
      groups={groups}
      shopSlug="blue-mantis"
      t={t}
      diverT={diverT}
      currentTemplateVersion={options.currentTemplateVersion ?? new Map()}
      catalog={options.catalog === undefined ? { href: "/catalog", count: 34 } : options.catalog}
    />,
  );
}

/** One unrated row, for the tests that are about something other than grouping. */
function renderRow(
  overrides: Partial<Site>,
  options?: Parameters<typeof renderLedger>[1],
): ReturnType<typeof renderLedger> {
  return renderLedger([group("unrated", site(overrides))], options);
}

/**
 * **The pin the roadmap names for slice 9a** (ADR 20260827-the-shops-shelves):
 * requirement words only above Open Water.
 *
 * The old table wore an "Open Water" badge on most of its rows — the
 * certification every diver on a recreational charter already holds, restated
 * once per row. What survives is the reading that changes what a staffer does.
 */
describe("the requirement words", () => {
  it("says nothing for a site that asks only for Open Water", () => {
    renderRow({ minimumCertificationLevel: "open_water" });
    expect(screen.queryByText("Open Water")).toBeNull();
  });

  it("names the level once it is above Open Water", () => {
    renderRow({ minimumCertificationLevel: "advanced_open_water" });
    expect(screen.getByText(/Advanced Open Water/)).toBeInTheDocument();
  });

  it("names specialties and nitrox at any level, including none at all", () => {
    renderRow({ requiredSpecialties: ["night"], requiresNitrox: true });
    // Both words, on a site with no certification requirement whatsoever: a
    // Night specialty on an unrestricted reef is exactly the row that used to
    // go silent behind a "1 required specialty" count.
    expect(screen.getByText("Night · Nitrox")).toBeInTheDocument();
  });

  it("keeps warning ink for the rows whose level is also above Open Water", () => {
    const quiet = renderRow({ requiresNitrox: true });
    expect(quiet.container.querySelector(".text-warning-strong")).toBeNull();
    cleanup();

    const loud = renderRow({
      minimumCertificationLevel: "rescue",
      requiredSpecialties: ["deep"],
    });
    // Colour is the degree; the words carry the fact either way, so the quiet
    // row above is not a row that says less.
    expect(loud.container.querySelector(".text-warning-strong")?.textContent).toBe(
      "Rescue Diver · Deep",
    );
  });
});

/**
 * A shared fact belongs to the group header, never repeated down the rows at
 * equal weight (ADR 20260827-clearwater-surface-language, decision 2).
 */
describe("the difficulty groups", () => {
  it("heads each group with its own word and renders nothing for the empty ones", () => {
    renderLedger([
      group("beginner", site({ id: "a", name: "Molasses Reef", difficultyLevel: "beginner" })),
      group("advanced", site({ id: "b", name: "Spiegel Grove", difficultyLevel: "advanced" })),
      group("unrated", site({ id: "c", name: "Unwritten Ledge" })),
    ]);
    expect(screen.getAllByRole("heading", { level: 2 }).map((h) => h.textContent)).toEqual([
      "Beginner",
      "Advanced",
      "Unrated",
    ]);
    expect(screen.queryByText("Intermediate")).toBeNull();
  });

  it("never restates the group's own reading on its rows", () => {
    // `siteFit` reads "welcoming" off a beginner site and "demanding" off an
    // advanced one, which is the group heading in different words.
    renderLedger([
      group("beginner", site({ id: "a", name: "Molasses Reef", difficultyLevel: "beginner" })),
      group("advanced", site({ id: "b", name: "Spiegel Grove", difficultyLevel: "advanced" })),
    ]);
    expect(screen.queryByText(/Welcoming dive/)).toBeNull();
    expect(screen.queryByText(/Best with recent experience/)).toBeNull();
  });

  it("says the fit reading on the one row that cuts against its group", () => {
    renderLedger([group("beginner", site({ difficultyLevel: "beginner", fitTone: "demanding" }))]);
    expect(screen.getByText(/Best with recent experience/)).toBeInTheDocument();
  });

  it("stays silent about a fit nobody has read, even under Unrated", () => {
    // "Ask the crew about fit" beneath a heading that already says nobody has
    // rated this site is the same silence twice.
    renderRow({ fitTone: "unknown" });
    expect(screen.queryByText(/Ask the crew/)).toBeNull();
  });
});

/**
 * The `◆`/`◇` provenance glyph retires; what a staffer can act on stays.
 * `Badge` is the app's only pill and it marks the exceptional state
 * (20260827-clearwater-surface-language, decision 3).
 */
describe("the template provenance", () => {
  it("says nothing at all about a site sitting at the published version", () => {
    const { container } = renderRow(
      { sourceTemplateId: "tpl-1", sourceTemplateVersion: 2 },
      { currentTemplateVersion: new Map([["tpl-1", 2]]) },
    );
    expect(screen.queryByText(/DiveDay template/)).toBeNull();
    expect(container.querySelector(".rounded-full")).toBeNull();
    // The glyph pair went with the column it replaced.
    expect(container.textContent).not.toMatch(/[◆◇]/);
  });

  it("wears the one badge when an update is waiting", () => {
    const { container } = renderRow(
      { sourceTemplateId: "tpl-1", sourceTemplateVersion: 1 },
      { currentTemplateVersion: new Map([["tpl-1", 3]]) },
    );
    expect(container.querySelector(".rounded-full")?.textContent).toBe("Template update v3 ready.");
  });
});

/** The catalog is a door at the ledger's tail, never a second surface style. */
describe("the catalog door", () => {
  it("carries the whole catalog's count, and never claims to be near anybody", () => {
    renderRow({}, { catalog: { href: "/catalog", count: 34 } });
    expect(screen.getByRole("link", { name: "Browse the DiveDay catalog" })).toHaveAttribute(
      "href",
      "/catalog",
    );
    expect(screen.getByText("34 published sites")).toBeInTheDocument();
  });

  it("does not render when DiveDay has published nothing to browse", () => {
    renderRow({}, { catalog: null });
    expect(screen.queryByText(/Browse the DiveDay catalog/)).toBeNull();
  });

  it("is the ledger's tail, so an empty library has no door here at all", () => {
    // The sibling half of the rule: with no rows there is no ledger, and the
    // page's own two-door empty state owns the choice instead.
    const { container } = renderLedger([], { catalog: { href: "/catalog", count: 34 } });
    expect(container.querySelector("a")).toBeNull();
  });
});

/** The row is the door — the whole row, named by the site itself. */
describe("the row", () => {
  it("names its destination with the site's own name and nothing appended", () => {
    renderRow({ id: "site-42", name: "Benwood Wreck" });
    expect(screen.getByRole("link", { name: "Benwood Wreck" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/dive-sites/site-42",
    );
  });

  it("reads location, then depth, on one meta line", () => {
    renderRow({ locationName: "Key Largo", depthRange: "8–12 m" });
    expect(screen.getByText("Key Largo · 8–12 m")).toBeInTheDocument();
  });
});
