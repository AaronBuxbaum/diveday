// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SETTINGS_GROUPS, SETTINGS_RAIL_ROWS } from "../settings-groups";
import { SettingsRail } from "./SettingsRail";
import { SettingsRailSkeleton } from "./SettingsRailSkeleton";

vi.mock("next/navigation", () => ({ usePathname: () => "/shop/blue-mantis/settings/print" }));

afterEach(cleanup);

/** The rail as an owner sees it: every group, every row. */
function renderRail() {
  render(
    <SettingsRail
      groups={SETTINGS_GROUPS.map((group) => ({
        id: group.id,
        label: group.id,
        rows: SETTINGS_RAIL_ROWS.filter((row) => row.group === group.id),
      }))}
      labels={Object.fromEntries(SETTINGS_RAIL_ROWS.map((row) => [row.id, row.id]))}
      shopBasePath="/shop/blue-mantis"
      ariaLabel="Settings sections"
    />,
  );
  return screen.getByRole("navigation", { name: "Settings sections" });
}

const classes = (element: Element | null | undefined) => [...(element?.classList ?? [])];

/**
 * **The rail's skeleton is drawn from the rail's own numbers** (pixel-craft
 * class 11: 0px of shift on load). It was `py-10 space-y-6`, 12px label bars
 * and 16px rows on a 24px pitch, where the rail is `py-6 space-y-5`, a 24px
 * label box and 44px rows: its first bar sat 16px below the label that
 * replaced it, and every row after that further off (K-345). The skeleton and
 * the rail now read one frame, one label box and one row box, so a change to
 * either is a change to both.
 */
describe("the settings rail's loading skeleton", () => {
  it("stands in the rail's column, from lg only", () => {
    const column = render(<SettingsRailSkeleton />).container.firstElementChild;
    const nav = renderRail();
    for (const name of ["hidden", "lg:block", "lg:w-[264px]", "lg:shrink-0"]) {
      expect(nav).toHaveClass(name);
      expect(column).toHaveClass(name);
    }
    expect(column).toHaveAttribute("aria-hidden", "true");
  });

  it("frames its groups as the rail's scroll box does", () => {
    const frame = render(<SettingsRailSkeleton />).container.firstElementChild?.firstElementChild;
    const scroller = renderRail().firstElementChild;
    // Everything that pins the rail; the skeleton does not scroll, so it clips
    // instead.
    const geometry = classes(scroller).filter((name) => name !== "overflow-y-auto");
    expect(geometry).toEqual(expect.arrayContaining(["sticky", "pe-2"]));
    expect(frame).toHaveClass(...geometry);
    // What places the first label and spaces the groups sits inside the box,
    // on what it scrolls, so a stuck label meets the box's top (K-221).
    const content = classes(scroller?.firstElementChild);
    expect(content).toEqual(expect.arrayContaining(["py-6", "space-y-5"]));
    expect(scroller).not.toHaveClass("py-6");
    expect(frame?.firstElementChild).toHaveClass(...content);
    expect(frame?.firstElementChild).not.toHaveClass("py-10");
    expect(frame?.firstElementChild).not.toHaveClass("space-y-6");
  });

  it("draws each group's label in the label's box and each row in the row's box", () => {
    const frame = render(<SettingsRailSkeleton />).container.firstElementChild?.firstElementChild;
    const groups = [...(frame?.firstElementChild?.children ?? [])];
    const nav = renderRail();
    const label = nav.querySelector(`#settings-rail-${SETTINGS_GROUPS[0].id}`);
    const words = label?.querySelector(":scope > span");
    const row = nav.querySelector("a");

    // One group per group the rail draws, each with as many rows.
    expect(groups).toHaveLength(SETTINGS_GROUPS.length);
    groups.forEach((group, index) => {
      const [labelBox, ...rows] = [...group.children];
      // The label: 8px above the rows, a 24px box of a 16px line in `py-1`.
      expect(label).toHaveClass("mb-2");
      expect(labelBox).toHaveClass("mb-2");
      const labelWords = labelBox?.firstElementChild;
      expect(classes(labelWords)).toEqual(expect.arrayContaining(classes(words)));
      expect(labelWords?.firstElementChild, "a bar the height of a text-xs line").toHaveClass(
        "h-4",
      );
      // The rows: the rail row's own 44px box, around a bar a text-sm line tall.
      expect(rows).toHaveLength(
        SETTINGS_RAIL_ROWS.filter((railRow) => railRow.group === SETTINGS_GROUPS[index]?.id).length,
      );
      for (const skeletonRow of rows) {
        for (const name of ["flex", "min-h-11", "items-center", "px-3", "py-2"]) {
          expect(row).toHaveClass(name);
          expect(skeletonRow).toHaveClass(name);
        }
        expect(skeletonRow).not.toHaveClass("h-4");
        expect(skeletonRow.firstElementChild).toHaveClass("h-5");
      }
    });
  });
});
