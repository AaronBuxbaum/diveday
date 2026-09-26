// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SettingsDoorRow, SettingsRow } from "./SettingsRows";

/**
 * The two row kinds as geometry. They sit interleaved in one `InsetGroup`,
 * whose `divide-y` hangs a 1px rule on every row but the last — so what a row
 * is measured from is the element that rule lands on, and the two kinds have
 * to put their height in the same place relative to it. Behaviour (which row
 * opens, what a door says at rest) is pinned in `SettingsRail.test.tsx`.
 */

afterEach(cleanup);

const DOOR = "/shop/blue-mantis/settings/team";

function doorRow(external = false) {
  const { container } = render(
    <SettingsDoorRow
      href={external ? "mailto:help@example.com" : DOOR}
      heading="Team"
      external={external}
    />,
  );
  return container.firstElementChild as HTMLElement;
}

function settingRow(props: Partial<Parameters<typeof SettingsRow>[0]> = {}) {
  const { container } = render(
    <SettingsRow heading="Sales tax & VAT" {...props}>
      <span>form</span>
    </SettingsRow>,
  );
  return container.firstElementChild as HTMLElement;
}

describe("one row height, whichever kind of row", () => {
  /**
   * A door row put `min-h-14` on the very element `divide-y` borders, so its
   * 1px rule came out of its 56px (box-sizing is border-box) and it drew 55px,
   * while a setting's `<summary>` keeps its 56px *inside* the `<details>` that
   * takes the rule. On the settings hub the rules fell at a 56px pitch through
   * the doors and 57px through the settings — "Team" 1px shorter than "Tax"
   * beside it (K-53, SETTINGS-1-14, SETTINGS-2-11).
   */
  it("carries min-h-14 on a child of the element the group's divide-y borders, never on that element", () => {
    for (const row of [doorRow(), settingRow()]) {
      expect(row).not.toHaveClass("min-h-14");
      expect(row.firstElementChild).toHaveClass("min-h-14");
    }
  });
});

describe("one focus ring, whichever kind of row", () => {
  /**
   * A setting's `<summary>` is ringed inside itself across the whole row
   * (`LIST_ROW_SUMMARY_RING`), while a door kept the global ring on its link
   * text: a keyboard reader tabbing down the hub saw a row-wide band on "Tax"
   * and a 36×19px square round the word "Team" on the next row (K-101,
   * SETTINGS-1-23, ATLAS-1-19). The door's target is already the whole row —
   * the stretched `::after` — so that overlay wears the inset ring, the way
   * `RowLink` rings its cell, and the text is not ringed a second time.
   */
  for (const external of [false, true]) {
    it(`rings a door row's overlay inside the row, not its words${external ? " (external link)" : ""}`, () => {
      doorRow(external);
      expect(screen.getByRole("link", { name: "Team" })).toHaveClass(
        "after:absolute",
        "after:inset-0",
        "focus-visible:outline-none",
        "focus-visible:after:focus-ring-inset",
      );
    });
  }

  it("bends a door row's ring into the group's corners at either end, as a summary's does", () => {
    // `InsetGroup` clips at its 20px corner; a square ring at the group's first
    // or last row would have its corners shaved off.
    const row = doorRow();
    expect(row).toHaveClass("group/door");
    expect(screen.getByRole("link", { name: "Team" })).toHaveClass(
      "group-first/door:after:rounded-t-panel",
      "group-last/door:after:rounded-b-panel",
    );
  });
});
