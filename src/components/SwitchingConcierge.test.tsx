// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { SwitchingConcierge, SwitchingConciergeSkeleton } from "./SwitchingConcierge";

afterEach(cleanup);

/**
 * **The concierge's skeleton is the concierge, box for box and line for line**
 * (K-406).
 *
 * The switching hub's skeleton stopped at its list and drew nothing for the
 * concierge under it, a 494px panel on a phone. The offer is the same copy on
 * every switching page, so its line counts are the component's own: the
 * eyebrow two 20px lines on a phone and one from `sm`, the title two 32px
 * lines and one 36px line, the offer seven 32px lines and three, then the
 * 48px door.
 */
describe("the concierge's skeleton", () => {
  function renderPair() {
    const skeleton = render(<SwitchingConciergeSkeleton />).container;
    const real = render(<SwitchingConcierge locale="en-US" />).container;
    return { skeleton, real };
  }

  it("draws the offer's own section and panel", () => {
    const { skeleton, real } = renderPair();
    expect(skeleton.firstElementChild?.className).toBe(real.firstElementChild?.className);
    expect(skeleton.firstElementChild?.firstElementChild?.className).toBe(
      real.firstElementChild?.firstElementChild?.className,
    );
  });

  it("paints nothing a reader could tap", () => {
    const { skeleton } = renderPair();
    expect(skeleton.querySelectorAll("a, button, form, input")).toHaveLength(0);
  });

  it("stands a bar the height of each line, and a 48px bar for the door", () => {
    const { skeleton } = renderPair();
    const [eyebrow, title, offer, door] = Array.from(
      skeleton.firstElementChild?.firstElementChild?.children ?? [],
    );
    const linesOf = (wrapper: Element) => Array.from(wrapper.children);
    expect(linesOf(eyebrow)).toHaveLength(2);
    for (const line of linesOf(eyebrow)) expect(line).toHaveClass("h-5");
    expect(title).toHaveClass("mt-3");
    expect(linesOf(title)).toHaveLength(2);
    for (const line of linesOf(title)) expect(line).toHaveClass("h-8", "sm:h-9");
    expect(offer).toHaveClass("mt-4");
    expect(linesOf(offer)).toHaveLength(7);
    for (const line of linesOf(offer)) expect(line).toHaveClass("h-8");
    expect(linesOf(offer).filter((line) => line.classList.contains("sm:hidden"))).toHaveLength(4);
    expect(door).toHaveClass("mt-6", "h-12");
  });
});
