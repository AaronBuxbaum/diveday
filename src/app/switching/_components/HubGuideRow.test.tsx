// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HubGuideRow } from "./HubGuideRow";

afterEach(cleanup);

/**
 * **The hub's rows: a hover fill that never touches its words or its rules.**
 *
 * The pixel probe (2026-09-25, switching-hub) measured each guide row's hover
 * fill leaving 0px between its left edge and the guide's title: the row link
 * was both the fill and the hairline, with no horizontal padding of its own.
 */
function renderRow() {
  render(
    <ul>
      <HubGuideRow
        href="/switching/eve"
        title="Switching from EVE"
        summary="Bring your divers, their certifications and the next season's bookings."
      />
    </ul>,
  );
  const link = screen.getByRole("link", { name: /Switching from EVE/ });
  const item = link.closest("li");
  return { link, item };
}

describe("a switching hub row", () => {
  it("draws its rule on the list item, not on the link that paints the fill", () => {
    // The rule stays on the text column, so the list's top rule, every row's
    // rule and the closing band's rule stay one length.
    const { link, item } = renderRow();
    expect(item).toHaveClass("border-b", "border-border");
    expect(link.className).not.toMatch(/(?:^|\s)border/);
  });

  it("hovers a rounded chip with 16px of room each side, the title on the column, and the item's 8px above and below keeping it off both rules", () => {
    const { link, item } = renderRow();
    // Room inside the fill, handed back as an equal negative margin, so the
    // title starts where the page's heading does.
    expect(link).toHaveClass("-mx-4", "px-4", "py-4", "rounded-lg", "hover:bg-surface");
    // The item's own padding is what separates the chip from the rules.
    expect(item).toHaveClass("py-2");
    expect(item?.className).not.toMatch(/(?:^|\s)-?(?:m|p)[xse]-/);
  });
});
