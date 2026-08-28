// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { CourseRoster, type CourseRosterRow, groupCoursesByAgency } from "./CourseRoster";

afterEach(cleanup);

/**
 * Slice 9g of ADR 20260827-the-shops-shelves: the roster is one ledger grouped
 * by agency, in place of a tab strip that showed one agency at a time.
 *
 * What is pinned here is the rule, never the layout. Two of them, and both
 * regress silently:
 *
 * - **Progression order survives the grouping.** The order a shop teaches in
 *   is the query's (`progressionOrder`, agency-major since this slice), and a
 *   component that sorted its own rows — alphabetically, or by grouping into a
 *   map and reading the keys back — would put Advanced Open Water above Open
 *   Water and look tidy doing it. So the grouper walks consecutive runs and
 *   the render preserves the order it was handed.
 * - **A course the shop has hidden says the word.** Hidden is the roster's one
 *   exceptional state and its one badge; the greyed title is not allowed to be
 *   the only thing carrying it (20260827-clearwater-surface-language: every
 *   colour-carried state also carries a word).
 */

const LADDER: CourseRosterRow[] = [
  {
    id: "padi-dsd",
    agency: "padi",
    title: "Discover Scuba Diving",
    href: "/shop/blue-mantis/courses/discover-scuba-diving/edit",
    linkLabel: "Edit Discover Scuba Diving",
    meta: "Open to uncertified divers · Half day · $195",
  },
  {
    id: "padi-ow",
    // Imported free text: the same agency, spelled the way a CSV carried it.
    agency: " PADI ",
    title: "Open Water Diver",
    href: "/shop/blue-mantis/courses/open-water-diver/edit",
    linkLabel: "Edit Open Water Diver",
    meta: "Open to uncertified divers · 3 days · $595",
  },
  {
    id: "padi-aow",
    agency: "padi",
    title: "Advanced Open Water Diver",
    href: "/shop/blue-mantis/courses/advanced-open-water-diver/edit",
    linkLabel: "Edit Advanced Open Water Diver",
    meta: "Open Water or higher · 2 days · $475",
    hiddenLabel: "Hidden",
  },
  {
    id: "ssi-ow",
    agency: "SSI",
    title: "SSI Open Water Diver",
    href: "/shop/blue-mantis/courses/ssi-open-water-diver/edit",
    linkLabel: "Edit SSI Open Water Diver",
    meta: "Open to uncertified divers · 3 days · $575",
  },
];

describe("grouping the roster by agency", () => {
  it("gathers the imported spellings of one agency into a single group", () => {
    const groups = groupCoursesByAgency(LADDER);
    expect(groups.map((group) => group.agency)).toEqual(["padi", "ssi"]);
    expect(groups[0]?.courses.map((course) => course.id)).toEqual([
      "padi-dsd",
      "padi-ow",
      "padi-aow",
    ]);
  });

  it("keeps the order it was handed, never re-sorting inside a group", () => {
    const groups = groupCoursesByAgency(LADDER);
    // The teaching ladder, which alphabetical would open on Advanced Open
    // Water — the one course a beginner cannot take.
    expect(groups[0]?.courses.map((course) => course.title)).toEqual([
      "Discover Scuba Diving",
      "Open Water Diver",
      "Advanced Open Water Diver",
    ]);
  });

  it("starts a second group when an agency's run resumes, rather than merging it", () => {
    // The query sorts agency-major so this cannot happen; if it ever stopped,
    // the roster must draw the break rather than quietly gather rows out of
    // the progression order they were read in.
    const interleaved = [LADDER[0], LADDER[3], LADDER[1]].filter(
      (row): row is CourseRosterRow => row !== undefined,
    );
    expect(groupCoursesByAgency(interleaved).map((group) => group.agency)).toEqual([
      "padi",
      "ssi",
      "padi",
    ]);
  });

  it("has no groups at all for an empty roster", () => {
    expect(groupCoursesByAgency([])).toEqual([]);
  });
});

describe("the roster ledger", () => {
  it("names each agency once, above its own run of rows", () => {
    render(<CourseRoster rows={LADDER} />);
    const headings = screen.getAllByRole("heading", { level: 2 });
    expect(headings.map((heading) => heading.textContent)).toEqual(["PADI", "SSI"]);

    const padi = screen.getByRole("list", { name: "PADI" });
    expect(within(padi).getAllByRole("listitem")).toHaveLength(3);
    expect(within(screen.getByRole("list", { name: "SSI" })).getAllByRole("listitem")).toHaveLength(
      1,
    );
  });

  it("renders the rows in the order given", () => {
    render(<CourseRoster rows={LADDER} />);
    const titles = screen.getAllByRole("listitem").map((row) => row.textContent ?? "");
    expect(titles[0]).toContain("Discover Scuba Diving");
    expect(titles[1]).toContain("Open Water Diver");
    expect(titles[2]).toContain("Advanced Open Water Diver");
    expect(titles[3]).toContain("SSI Open Water Diver");
  });

  it("makes every row the door to its own editor, named", () => {
    render(<CourseRoster rows={LADDER} />);
    expect(screen.getByRole("link", { name: "Edit Open Water Diver" })).toHaveAttribute(
      "href",
      "/shop/blue-mantis/courses/open-water-diver/edit",
    );
  });

  it("says the word on a hidden course, and says nothing on the rest", () => {
    render(<CourseRoster rows={LADDER} />);
    expect(screen.getAllByText("Hidden")).toHaveLength(1);
    const hidden = screen
      .getAllByRole("listitem")
      .find((row) => row.textContent?.includes("Advanced Open Water Diver"));
    expect(hidden?.textContent).toContain("Hidden");
  });

  it("carries the row's own acts beside it", () => {
    const withActs: CourseRosterRow = {
      id: "padi-dsd",
      agency: "padi",
      title: "Discover Scuba Diving",
      href: "/shop/blue-mantis/courses/discover-scuba-diving/edit",
      linkLabel: "Edit Discover Scuba Diving",
      meta: "Open to uncertified divers",
      actions: <button type="button">Schedule</button>,
    };
    render(<CourseRoster rows={[withActs]} />);
    expect(screen.getByRole("button", { name: "Schedule" })).toBeTruthy();
  });
});
