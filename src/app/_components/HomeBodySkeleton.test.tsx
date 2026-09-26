// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HomeBodySkeleton } from "./HomeBodySkeleton";

afterEach(cleanup);

/** The hero's two columns: the claim, then the captain's phone. */
function heroColumns(container: HTMLElement) {
  const grid = container.querySelector("section > div");
  const [claim, phone] = [...(grid?.children ?? [])];
  if (!claim || !phone) throw new Error("no hero columns");
  return { claim, phone };
}

/**
 * **The landing's skeleton is the hero it stands in for** (docs/design/
 * pixel-craft.md, class 11; K-393).
 *
 * It still drew the bordered three-field "try it" panel the hero lost when
 * shops began to be set up by hand, a guessed 480px phone where the frame
 * renders 450px, and two title bars and two description bars for a title of
 * six lines on a phone (five from `lg`) and a description of four (three from
 * `sm`). Deleting the panel alone would have lifted the phone 390px on a
 * phone, so the claim is drawn a line box per line, as the page sets it.
 */
describe("the landing's skeleton", () => {
  it("draws no try-it panel under the hero's doors", () => {
    const { container } = render(<HomeBodySkeleton />);
    expect(heroColumns(container).claim.querySelector(".rounded-panel")).toBeNull();
  });

  it("draws the phone at the 450px the frame renders at", () => {
    const { container } = render(<HomeBodySkeleton />);
    const phone = heroColumns(container).phone.firstElementChild;
    expect(phone).toHaveClass("h-[450px]");
    expect(phone).not.toHaveClass("h-[30rem]");
  });

  it("draws a line box for each line the title wraps to: six on a phone, four from sm, five from lg", () => {
    const { container } = render(<HomeBodySkeleton />);
    const lines = [...heroColumns(container).claim.querySelectorAll(".lg\\:h-18")];
    expect(lines).toHaveLength(6);
    const shown = (at: "base" | "sm" | "lg") =>
      lines.filter((line) => {
        const hiddenFromSm = line.classList.contains("sm:hidden");
        const backAtLg = line.classList.contains("lg:block");
        if (at === "base") return true;
        if (at === "sm") return !hiddenFromSm;
        return !hiddenFromSm || backAtLg;
      }).length;
    expect([shown("base"), shown("sm"), shown("lg")]).toEqual([6, 4, 5]);
  });

  it("draws the description's four lines on a phone and three from sm", () => {
    const { container } = render(<HomeBodySkeleton />);
    const lines = [...heroColumns(container).claim.querySelectorAll(".h-8")];
    expect(lines).toHaveLength(4);
    expect(lines.filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(1);
  });
});
