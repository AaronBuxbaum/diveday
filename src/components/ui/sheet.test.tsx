// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SHEET_PANEL_CLASS, SheetHeader } from "./sheet";

afterEach(cleanup);

const SRC = join(import.meta.dirname, "..", "..");

/** The bottom sheets: a person from the manifest. */
const SHEETS = ["app/shop/[shopSlug]/trips/[id]/manifest/_components/PersonSheet.tsx"];

/**
 * **One sheet, one shell** (pixel-craft classes 6 and 12). The manifest's
 * person sheet and the day's diver sheet were hand copies of one panel, and
 * both rounded their top corners at an arbitrary 22px, against the 20px
 * `rounded-panel` of every card under them (K-557).
 */
describe("SHEET_PANEL_CLASS", () => {
  it("rounds its top corners on the panel rung, never an arbitrary radius", () => {
    expect(SHEET_PANEL_CLASS.split(/\s+/)).toContain("rounded-t-panel");
    expect(SHEET_PANEL_CLASS).not.toMatch(/rounded-[a-z-]*\[/);
  });

  it("is the one shell every sheet wears", () => {
    for (const file of SHEETS) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toContain("SHEET_PANEL_CLASS");
      expect(source, file).not.toMatch(/rounded-t-\[/);
    }
  });
});

/**
 * **The name, its status and the close share one centre** (K-269). The header
 * was a `flex items-start` row: a 26px pill, a 44px close and a 32px name line
 * all hung from the top, so the pill's centre sat 5px above the name's and the
 * close 5.5px below it. It is a two-row grid: the name and the trailing group
 * centred on one row, the subtitle under both, across the sheet's whole width.
 */
describe("SheetHeader", () => {
  function renderHeader() {
    render(
      <SheetHeader
        titleId="title"
        descriptionId="description"
        title="Meera Iyer"
        subtitle="Diver · Own kit"
        actions={
          <>
            <span>Awaiting roll call</span>
            <button type="button">Close</button>
          </>
        }
      />,
    );
    const title = screen.getByRole("heading", { name: "Meera Iyer" });
    const header = title.parentElement as HTMLElement;
    return { title, header };
  }

  it("centres the name and the trailing group on one row", () => {
    const { title, header } = renderHeader();
    expect(header.tagName).toBe("HEADER");
    expect(header).toHaveClass("grid", "items-center");
    expect(header.className).not.toMatch(/items-start/);
    const actions = title.nextElementSibling as HTMLElement;
    expect(actions).toContainElement(screen.getByRole("button", { name: "Close" }));
    expect(actions).toHaveClass("flex", "items-center");
  });

  it("lets the name's line, not the 44px close, set the first row's height", () => {
    // In a 44px row a one-line name (a 32px line) was centred 6px down, and the
    // subtitle landed 10px under it; a wrapped name set the row itself and its
    // subtitle sat 4px under. The group hands back the close's unseen 12px as
    // `-my-1.5`, so its margin box is the name's one line and the subtitle is
    // `gap-y-1` under the name whether or not the name wraps.
    const { title, header } = renderHeader();
    const actions = title.nextElementSibling as HTMLElement;
    expect(actions).toHaveClass("-my-1.5");
    expect(header).toHaveClass("gap-y-1");
    expect(title.className).not.toMatch(/(^|\s)(leading-11|min-h-11|py-)/);
  });

  it("runs the subtitle across both columns, under the name and the group", () => {
    const { header } = renderHeader();
    const subtitle = screen.getByText("Diver · Own kit");
    expect(subtitle.parentElement).toBe(header);
    expect(subtitle).toHaveAttribute("id", "description");
    expect(subtitle).toHaveClass("col-span-2");
    expect(header.lastElementChild).toBe(subtitle);
  });

  it("is the one header both sheets wear", () => {
    for (const file of SHEETS) {
      const source = readFileSync(join(SRC, file), "utf8");
      expect(source, file).toMatch(/<SheetHeader\b/);
      expect(source, file).not.toMatch(/<header\b/);
    }
  });
});
