// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DemoStoryLoading from "./loading";

afterEach(cleanup);

/**
 * **The demo door's skeleton is the door** (docs/design/pixel-craft.md, class
 * 11; K-576). It was hand-rolled beside `EntryShellSkeleton`, and it drew a
 * full-width 44px bar where the page lands a 146 × 48px button centred in
 * the column (the door's `<form>` is a shrink-wrapped item of the shell's
 * `items-center` column, so the button's `w-full` never had a width to fill),
 * a 28px wordmark bar over a 24px wordmark, and one 40px bar for a
 * description that is two 24px lines at every width.
 */
describe("the demo story door's skeleton", () => {
  it("draws the shell's centred button bar, not a full-width one", () => {
    const { container } = render(<DemoStoryLoading />);
    const pulse = container.querySelector(".animate-pulse");
    const button = pulse?.lastElementChild;
    expect(button).toHaveClass("mx-auto", "w-44", "h-12");
    expect(button).not.toHaveClass("w-full");
  });

  it("draws the wordmark, the eyebrow, the title and two description lines", () => {
    const { container } = render(<DemoStoryLoading />);
    const header = container.querySelector(".animate-pulse > div");
    expect(header?.firstElementChild).toHaveClass("h-6", "mb-8");
    expect(header?.querySelectorAll(".h-9")).toHaveLength(1);
    expect(header?.querySelectorAll(".h-6")).toHaveLength(3);
  });

  it("has no footer row, as the door has none", () => {
    const { container } = render(<DemoStoryLoading />);
    expect(container.querySelector(".h-5")).toBeNull();
  });
});
