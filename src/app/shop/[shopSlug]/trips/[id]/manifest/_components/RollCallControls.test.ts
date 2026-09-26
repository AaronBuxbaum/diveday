import { describe, expect, it } from "vitest";
import { ROW_DISCLOSURE_PANEL_CLASS } from "./RollCallControls";

/**
 * **The person's details box shares the sheet's edges** (pixel-craft class 3).
 *
 * The box was a row disclosure's inset once, `mx-4 mb-4` inside a roll-call
 * row. It is rendered inside `PersonSheet` now, whose body already pads the
 * sheet (`px-5 sm:px-7`, and a 20px foot), so the inset stood the grey box
 * 16px inside the "Buddy team" box right above it: two box widths and three
 * left edges on one sheet, and 36px under it against the sheet's 20px.
 */
describe("the person's details box", () => {
  it("adds no margin of its own inside the sheet's padding", () => {
    const tokens = ROW_DISCLOSURE_PANEL_CLASS.split(/\s+/);
    expect(tokens.filter((token) => /^-?m[xytrblse]?-/.test(token))).toEqual([]);
    expect(tokens).toEqual(expect.arrayContaining(["rounded-inset", "border", "p-3"]));
  });
});
