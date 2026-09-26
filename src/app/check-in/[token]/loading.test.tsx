// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KioskCheckInLoading from "./loading";

afterEach(cleanup);

const PAGE_SOURCE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const CONSOLE_SOURCE = readFileSync(
  join(import.meta.dirname, "_components", "KioskConsole.tsx"),
  "utf8",
);

/** The page's own header classes, read from its source: the page needs a token and a database. */
const PAGE_HEADER = PAGE_SOURCE.match(/<header\s+className="([^"]+)"/)?.[1] ?? "";

/** The `className` of the first `<tag … className="…">` at or after `from` in `source`. */
function classOf(source: string, tag: string, from = 0): string {
  const classes = source
    .slice(from)
    .match(new RegExp(`<${tag}\\b[^>]*?\\sclassName="([^"]+)"`))?.[1];
  expect(classes, `a <${tag} className="…"> is where this test looks`).toBeDefined();
  return classes ?? "";
}

/**
 * The bar class for the line box a `leading-tight` line of `text-[Nrem]`
 * draws: `h-10` for 2.5rem, `h-[Nrem]` otherwise.
 */
function lineBoxBar(classes: string): string {
  expect(classes).toContain("leading-tight");
  const size = classes.split(/\s+/).find((token) => /^text-\[[\d.]+rem\]$/.test(token));
  expect(size, `a text-[Nrem] size in "${classes}"`).toBeDefined();
  const rem = Number(size?.slice("text-[".length, -"rem]".length)) * 1.25;
  return rem === 2.5 ? "h-10" : `h-[${rem}rem]`;
}

/** The skeleton's header row: the first row inside the pulsing block. */
function headerRow(container: HTMLElement): HTMLElement {
  const row = container.querySelector<HTMLElement>("main .animate-pulse > div:first-child");
  expect(row, "the skeleton has a header row").not.toBeNull();
  return row as HTMLElement;
}

describe("the self check-in kiosk's header", () => {
  /**
   * **The date shares the shop name's last baseline** (K-256). `items-end`
   * lined up the two line boxes' bottoms, and a 32px heading's descent is
   * deeper than a 20px date's, so the date sat 3px under the name.
   */
  it("sets the date on the shop name's last baseline", () => {
    const header = PAGE_HEADER.split(/\s+/);
    expect(header).toContain("items-baseline-last");
    expect(header).not.toContain("items-end");
  });

  /**
   * The skeleton's row is the page's row: at 390 the name and the date stack,
   * and the console below centres in what the header leaves, so a header that
   * stayed one row moved the whole console when the token verified.
   */
  it("lays its skeleton's header bars out exactly as the page lays out its header", () => {
    expect(PAGE_HEADER, "the page's <header> is where this test looks").not.toBe("");
    const { container } = render(<KioskCheckInLoading />);
    expect(headerRow(container).className).toBe(PAGE_HEADER);
  });
});

describe("the self check-in kiosk's skeleton", () => {
  /**
   * **The console stands where it lands** (K-531). The page centres the
   * console in what the header leaves, so every bar's height moves it: the
   * name bar was 4px short of its line box, the prompt 3px, the label 2px,
   * and the block was 244px against the loaded 251 — the heading moved about
   * 1.5px and the button's foot about 5.5px when the token verified.
   */
  it("sizes the name and date bars to the header's line boxes", () => {
    const { container } = render(<KioskCheckInLoading />);
    const [name, date] = Array.from(headerRow(container).children);
    const header = PAGE_SOURCE.slice(PAGE_SOURCE.indexOf("<header"));
    expect(name).toHaveClass(lineBoxBar(classOf(header, "h1")));
    expect(date).toHaveClass(lineBoxBar(classOf(header, "p")));
  });

  it("sizes the console's bars to the prompt, the label, the box and the boat button", () => {
    const { container } = render(<KioskCheckInLoading />);
    const block = container.querySelector("main .animate-pulse > div:last-child");
    const [title, label, box, button] = Array.from(block?.children ?? []);
    const afterHeader = PAGE_SOURCE.indexOf("</header>");
    expect(title).toHaveClass(lineBoxBar(classOf(PAGE_SOURCE, "p", afterHeader)));
    expect(label).toHaveClass(lineBoxBar(classOf(CONSOLE_SOURCE, "label")));
    // The box is `min-h-16`, and the button the `boat` size's 56px (K-339).
    expect(box).toHaveClass("h-16");
    expect(button).toHaveClass("h-14");
  });
});
