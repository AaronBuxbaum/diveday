// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { InfoHint } from "./InfoHint";

afterEach(cleanup);

function renderHint() {
  render(<InfoHint label="About BCD" detail="A buoyancy control device." />);
  return screen.getByRole("button", { name: "About BCD" });
}

describe("InfoHint", () => {
  /**
   * **The mark reads as an "i", not a grey dot** (pixel-craft class 2). It was
   * drawn at `size-3`, 12px, under a comment promising 20: the knockout "i" was
   * 1.65px across at its dot and anti-aliasing all but erased it, so on the
   * readiness page's gear list the marker beside "BCD" was a dot.
   */
  it("draws the glyph at the 20px its box is", () => {
    const glyph = renderHint().querySelector("svg");
    expect(glyph).toHaveClass("size-5");
    expect(glyph).not.toHaveClass("size-3");
  });

  /**
   * **The ring rings the mark, and the target is still 44px** (pixel-craft
   * class 7). The button was a 44px box pulled back with `-m-3`, and the
   * global ring drew 5px outside *that*: a 54px circle round a 12px glyph that
   * crossed the "$15.00" beside it. The button is now the glyph's own box, so
   * the ring sits 5px round the mark, and the 44px target is a stretched
   * `::after`, which counts as target (docs/design/pixel-craft.md, "Targets").
   */
  it("is the glyph's own box, with a stretched 44px target", () => {
    const trigger = renderHint();
    expect(trigger).toHaveClass(
      "relative",
      "size-5",
      "rounded-full",
      "after:absolute",
      "after:-inset-3",
      "after:rounded-full",
    );
    for (const token of ["-m-3", "size-11", "p-3"]) expect(trigger).not.toHaveClass(token);
    // The global ring, not a hand-drawn one: nothing here turns it off.
    expect(trigger.className).not.toMatch(/outline-none|ring-/);
  });

  it("stays a plain button that never submits the settings form around it", () => {
    expect(renderHint()).toHaveAttribute("type", "button");
  });
});
