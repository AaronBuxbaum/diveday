// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SETTINGS_GROUPS } from "../settings-groups";
import { SettingsGroupAnchors } from "./SettingsGroupAnchors";

afterEach(cleanup);

const GROUP_LABELS = {
  "your-shop": "Your shop",
  money: "Money",
  "data-integrations": "Data & integrations",
};

describe("the settings hub's jump row", () => {
  it("makes each group name an anchor into the section it names", () => {
    render(<SettingsGroupAnchors ariaLabel="Settings sections" groupLabels={GROUP_LABELS} />);
    expect(screen.getByRole("link", { name: "Data & integrations" })).toHaveAttribute(
      "href",
      "#data-integrations",
    );
  });

  it("offers an anchor for every group the hub renders a section for", () => {
    // The other half of the pair `SettingsPage.test.tsx` holds: that page
    // renders one section per registered group, and this row links to every
    // one of them. A group added to `SETTINGS_GROUPS` and missed on either
    // side fails one of the two.
    render(<SettingsGroupAnchors ariaLabel="Settings sections" groupLabels={GROUP_LABELS} />);
    const anchors = screen.getAllByRole("link").map((link) => link.getAttribute("href"));
    expect(anchors).toEqual(SETTINGS_GROUPS.map((group) => `#${group.id}`));
  });
});
