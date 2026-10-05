// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { FeaturePageSkeleton } from "./FeaturePageSkeleton";

afterEach(cleanup);

const WIDTHS = ["base", "sm", "lg", "xl"] as const;

/** Whether a line box is drawn at one width, read off its own classes in cascade order. */
function drawnAt(line: Element, width: (typeof WIDTHS)[number]): boolean {
  let shown = !line.classList.contains("hidden");
  for (const step of WIDTHS.slice(1, WIDTHS.indexOf(width) + 1)) {
    if (line.classList.contains(`${step}:block`)) shown = true;
    if (line.classList.contains(`${step}:hidden`)) shown = false;
  }
  return shown;
}

/** The line boxes of one block of bars, counted at each width. */
function linesOf(block: Element | null | undefined) {
  const lines = [...(block?.querySelectorAll(":scope > .h-lh") ?? [])];
  return Object.fromEntries(
    WIDTHS.map((width) => [width, lines.filter((line) => drawnAt(line, width)).length]),
  );
}

/** The claim's column: breadcrumb, title, lede, the doors, the demo note, the price. */
function claim(container: HTMLElement) {
  const column = container.querySelector("main > section > div > div");
  if (!column) throw new Error("no claim column");
  return column;
}

/**
 * **A feature page's skeleton wraps where the pages do** (measured on the
 * twelve pages, 2026-10-05, and again after the ledes became one sentence).
 * The hero is one column to `lg` and two from it, so the claim's column
 * narrows again at `lg` and the title and lede wrap to more lines there than
 * at `sm`. Bars for a phone and `sm` alone landed the hero a line short at
 * 1024 and a line long at 1280.
 */
describe("the feature page skeleton", () => {
  it("draws the title five lines on a phone, three from sm, five from lg and four from xl", () => {
    const { container } = render(<FeaturePageSkeleton />);
    const title = claim(container).querySelector(".text-4xl");
    expect(linesOf(title)).toEqual({ base: 5, sm: 3, lg: 5, xl: 4 });
  });

  it("draws the lede five, three, four and three lines of 32px", () => {
    const { container } = render(<FeaturePageSkeleton />);
    const lede = claim(container).querySelector(".leading-8");
    expect(linesOf(lede)).toEqual({ base: 5, sm: 3, lg: 4, xl: 3 });
  });

  it("draws the demo note three lines on a phone and two from sm, then the price two and one", () => {
    const { container } = render(<FeaturePageSkeleton />);
    const blocks = claim(container).querySelectorAll(":scope > div > .text-sm");
    const [note, price] = [...blocks].slice(-2);
    expect(linesOf(note)).toEqual({ base: 3, sm: 2, lg: 2, xl: 2 });
    expect(linesOf(price)).toEqual({ base: 2, sm: 1, lg: 1, xl: 1 });
  });

  it("draws nothing a visitor could tap", () => {
    const { container } = render(<FeaturePageSkeleton />);
    expect(container.querySelector("a, button, input")).toBeNull();
  });
});
