// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
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

function doorRow() {
  const { container } = render(<SettingsDoorRow href={DOOR} heading="Team" />);
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
