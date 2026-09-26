// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { rendersFlush } from "@/test/button-flush";
import { CatchUpStrip } from "./CatchUpStrip";

/**
 * The three bans the manifest's catch-up strip keeps, pinned at the component
 * rather than left to the path-based illustration walk — no drawing, no coral,
 * no motion (ADR 20260904-reef-all-the-way-down, Budget rule 8) — plus the two
 * properties that make it a catch-up rather than a panel: it renders nothing
 * when there is nothing new, and it never reaches paper.
 */

afterEach(cleanup);

const props = {
  label: "Since you looked at 6:10 · from the desk",
  sentences: ["Ada Lindqvist has checked in.", "The meeting point moved."],
  dismissLabel: "Got it",
  dismissAction: async () => {},
};

describe("CatchUpStrip", () => {
  it("renders nothing when there is nothing new", () => {
    const { container } = render(<CatchUpStrip {...props} sentences={[]} />);
    expect(container).toBeEmptyDOMElement();
  });

  it("says everything in one paragraph, behind one control", () => {
    const { container } = render(<CatchUpStrip {...props} />);
    const paragraphs = container.querySelectorAll("p");
    expect(paragraphs).toHaveLength(1);
    expect(paragraphs[0]?.textContent).toBe(
      "Ada Lindqvist has checked in. The meeting point moved.",
    );
    expect(container.querySelectorAll("button")).toHaveLength(1);
  });

  it("keeps the strip off the printed sheet", () => {
    // The printed manifest goes ashore or into a coastguard's hands. A
    // paragraph about what the desk did at 06:40 is neither current nor
    // evidence by the time that sheet is read.
    const { container } = render(<CatchUpStrip {...props} />);
    expect(container.querySelector("section")?.className).toContain("print:hidden");
  });

  it("draws nothing — no icon, no illustration, no badge", () => {
    const { container } = render(<CatchUpStrip {...props} />);
    expect(container.querySelectorAll("svg")).toHaveLength(0);
    expect(container.querySelectorAll("img")).toHaveLength(0);
  });

  it("moves nothing of its own", () => {
    // Every element the strip itself owns. `buttonClass`'s shared press
    // feedback is deliberately out of scope: Budget rule 2 bans the three drawn
    // motions (the swell, a dial's water, the boat) on a manifest, not the
    // affordance every control in the app carries.
    const { container } = render(<CatchUpStrip {...props} />);
    for (const element of container.querySelectorAll("section, h2, p, form, div")) {
      expect(element.className).not.toMatch(/animate-|transition-|duration-/);
    }
  });

  it("keeps its dismiss control at a boat-sized target", () => {
    // 44px is the floor on every safety surface, and `sm` stands on it. Asserted on the class rather than a measured box because
    // jsdom lays nothing out.
    render(<CatchUpStrip {...props} />);
    const button = screen.getByRole("button", { name: "Got it" });
    expect(button.className).toMatch(/min-h-1[12]/);
  });

  /**
   * **"Got it" ends on the panel's inset, and its box stays out of the title's
   * line** (pixel-craft class 5, K-190). At the default `md` it was 48px with
   * `px-4`: the header row grew round it, the title sat 33px down a 16px
   * panel, and the word ended 33px inside the right edge. At `sm`, `flush`
   * keeps 8px of hover fill and hands it back as `-mx-2`, and `-my-2.5`
   * hands back what the 44px target adds round its 20px line — 24px, the
   * title's own line — so the title sits 16px down and the word ends 16px in,
   * with the target whole.
   */
  it("hands the dismiss target's room back to the panel's padding", () => {
    render(<CatchUpStrip {...props} />);
    const button = screen.getByRole("button", { name: "Got it" });
    // Asked of `buttonClass`, not spelled as `flush`'s tokens (K-83 moved its
    // room into a transparent border and `px-1.75`).
    expect(rendersFlush(button, "ghost", "sm")).toBe(true);
    expect(button).toHaveClass("-my-2.5", "text-sm");
    expect(button.className).not.toMatch(/(^|\s)(px-4|min-h-12)(\s|$)/);
  });

  it("reads its critical text at 16px, like every other line on the manifest", () => {
    const { container } = render(<CatchUpStrip {...props} />);
    expect(container.querySelector("p")?.className).toContain("text-base");
  });
});
