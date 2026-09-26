// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BoardLoading from "./loading";

afterEach(cleanup);

const PAGE_SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");

/** The page's own header classes, read from its source: the page needs a token and a database. */
const PAGE_HEADER = PAGE_SOURCE.match(/<header\s+className="([^"]+)"/)?.[1] ?? "";

/** The page's header, from `<header` to `</header>`: the shop name's `<h1>` and the date's `<p>`. */
const HEADER_BLOCK = PAGE_SOURCE.slice(
  PAGE_SOURCE.indexOf("<header"),
  PAGE_SOURCE.indexOf("</header>"),
);

/**
 * The line box a `leading-tight` line of `text-[Nrem]` draws, as the bar
 * class that stands in for it: `h-10` for 2.5rem, `h-[Nrem]` otherwise. The
 * `prefix` picks a breakpoint's size (`"lg:"`) or the base one (`""`).
 */
function lineBoxBar(tag: string, prefix: string): string {
  const classes = HEADER_BLOCK.match(new RegExp(`<${tag}\\s+className="([^"]+)"`))?.[1] ?? "";
  expect(classes, `the header's <${tag}> is leading-tight`).toContain("leading-tight");
  const size = classes
    .split(/\s+/)
    .find((token) => token.startsWith(`${prefix}text-[`) && token.endsWith("rem]"));
  expect(size, `the header's <${tag}> sets a ${prefix || "base "}size`).toBeDefined();
  const rem = Number(size?.slice(`${prefix}text-[`.length, -"rem]".length)) * 1.25;
  return rem === 2.5 ? `${prefix}h-10` : `${prefix}h-[${rem}rem]`;
}

/** The skeleton's header row: the first row inside the pulsing block. */
function headerRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>("main .animate-pulse > div:first-child");
  expect(row, "the skeleton has a header row").not.toBeNull();
  return row as HTMLElement;
}

describe("the departures board's skeleton", () => {
  /**
   * **The header row is the page's header row** (K-256): the same wrap, gaps
   * and alignment. At 390 the page's name and date stack, 78px tall, and a
   * skeleton that kept them on one 40px row put every card 38px high.
   */
  it("lays its header bars out exactly as the page lays out its header", () => {
    expect(PAGE_HEADER, "the page's <header> is where this test looks").not.toBe("");
    const { container } = render(<BoardLoading />);
    expect(headerRow(container).className).toBe(PAGE_HEADER);
  });

  /**
   * **Every departure starts where it lands** (K-468). The header bar was a
   * flat `h-10` under a name whose line box is 55px at `lg`, and the cards a
   * flat `h-36`: at 1280 the first card painted at y 128 and dropped to 143,
   * and every card grew 19px when the board arrived.
   */
  it("sizes its header bars to the name's and the date's line boxes at every step", () => {
    const { container } = render(<BoardLoading />);
    const [name, date] = Array.from(headerRow(container).children);
    expect(name).toHaveClass(lineBoxBar("h1", ""), lineBoxBar("h1", "lg:"));
    expect(date).toHaveClass(lineBoxBar("p", ""), lineBoxBar("p", "lg:"));
  });

  it("sizes each card to a departure as the board draws one", () => {
    // Measured, not derived: a departure's height is its content's. The first
    // card of the seeded board is 270px stacked at 390 (its title wraps),
    // 235px stacked at 820 and 163px across three columns at 1280.
    const { container } = render(<BoardLoading />);
    const cards = Array.from(container.querySelectorAll(".rounded-panel"));
    expect(cards).toHaveLength(3);
    for (const card of cards) {
      expect(card).toHaveClass("h-[16.875rem]", "sm:h-[14.6875rem]", "lg:h-[10.1875rem]");
    }
  });
});
