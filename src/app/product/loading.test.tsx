// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import ProductLoading from "./loading";

afterEach(cleanup);

/** The line boxes drawn in `type`'s line height, and which of them only a phone draws. */
function linesIn(scope: Element | null, type: string) {
  const lines = Array.from(scope?.querySelectorAll(".h-lh") ?? []).filter((line) =>
    type.split(" ").every((token) => line.classList.contains(token)),
  );
  return {
    count: lines.length,
    phoneOnly: lines.filter((line) => line.classList.contains("sm:hidden")).length,
  };
}

/**
 * **The /product skeleton is as tall as the hero and the chapter strip it
 * stands in for** (K-409).
 *
 * It drew 48px bars for 40px title lines (two, for three on a phone), two 20px
 * bars for a lede of 32px lines (four on a phone), no bar at all for the price
 * line under the demo note, and the strip as a wrapping row of 16px bars — so
 * the strip landed 36px lower at 1280 and 156px lower at 390, where six bars
 * had wrapped to three rows. Each bar is now a line box of the text it stands
 * for, and the strip is one row of 52px items with no padding above or below
 * them, as the real strip's tabs fill its bar (K-400).
 */
describe("the /product skeleton", () => {
  it("draws the title as three lines of its own type below sm and two from it", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    expect(linesIn(hero, "text-4xl sm:text-6xl")).toEqual({ count: 3, phoneOnly: 1 });
  });

  it("draws the lede as four 32px lines below sm and two from it", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    expect(linesIn(hero, "text-lg leading-8")).toEqual({ count: 4, phoneOnly: 2 });
  });

  it("draws the demo note and the price line under it, each a second line on a phone", () => {
    const { container } = render(<ProductLoading />);
    const hero = container.querySelector("main > section");
    // The eyebrow is one text-sm line; the note and the price line are two
    // more, each wrapping once below sm.
    expect(linesIn(hero, "text-sm")).toEqual({ count: 5, phoneOnly: 2 });
  });

  it("stands in for the strip with one unwrapping row of 52px items and no block padding", () => {
    const { container } = render(<ProductLoading />);
    const strip = container.querySelector("main > div > div");
    expect(strip).toHaveClass("flex-nowrap", "overflow-hidden", "px-6");
    expect(strip).not.toHaveClass("flex-wrap");
    expect(
      [...(strip?.classList ?? [])].filter((token) => /^(?:[\w-]+:)*-?[pm][ytb]-/.test(token)),
    ).toEqual([]);
    const items = Array.from(strip?.children ?? []);
    expect(items).toHaveLength(6);
    for (const item of items) expect(item).toHaveClass("h-13", "shrink-0");
  });
});
