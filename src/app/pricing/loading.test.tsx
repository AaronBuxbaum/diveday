// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import PricingLoading from "./loading";

afterEach(cleanup);

const PAGE = readFileSync(join(dirname(fileURLToPath(import.meta.url)), "page.tsx"), "utf8");

/** The hero section's column: the first `<section>` of the skeleton's `<main>`. */
function heroColumn() {
  const column = screen.getByRole("main").querySelector("section > div");
  if (!column) throw new Error("no hero column");
  return column;
}

/** The `max-w-*` the page's own hero column wears: the container just inside its first `<section>`. */
function pageMeasure() {
  const column = PAGE.match(/<section\b[^>]*>\s*<div className="([^"]*)"/)?.[1];
  const measure = column?.match(/(?:^|\s)(max-w-\S+)/)?.[1];
  if (!measure) throw new Error("no max-w-* on the pricing page's hero column");
  return measure;
}

/**
 * The lines each covered item wraps to in the two-column list at 1280, per
 * hero measure. On `max-w-4xl` a column's text is 376px and the practice-shop
 * line (about 420px) wraps; on `max-w-5xl` it is 440px and fits, so the
 * middle row is one line. A measure with no row here has not been measured.
 */
const COVERS_SM_LINES: Record<string, readonly number[]> = {
  "max-w-4xl": [2, 1, 1, 2, 1, 2],
  "max-w-5xl": [2, 1, 1, 1, 1, 2],
};

/**
 * **The pricing skeleton is the hero the page lands** (docs/design/
 * pixel-craft.md, class 11; K-408). It predated the annotated invoice (the
 * 2026-09-24 voice decision) and still drew the older order — figure, lede,
 * doors, list — on a narrower measure, so the doors painted where the invoice
 * lands and dropped 425px when it arrived, and the figure bar was 16px short
 * of the 72/96px figure.
 */
describe("the pricing skeleton", () => {
  /**
   * Read from the page rather than pinned: the hero's measure is the page's
   * call (K-404 widens it), and a pinned class let the two drift apart with
   * every test green. `check:loading-skeletons` compares only
   * `mx-auto w-full max-w-*` containers, which this hero is not.
   */
  it("stands on the measure the page's hero stands on", () => {
    render(<PricingLoading />);
    const own = [...heroColumn().classList].filter((name) => name.startsWith("max-w-"));
    expect(own).toEqual([pageMeasure()]);
  });

  it("draws each covered item at the lines it wraps to, on a phone and in two columns", () => {
    render(<PricingLoading />);
    const expected = COVERS_SM_LINES[pageMeasure()];
    if (!expected) throw new Error(`measure the covers list on ${pageMeasure()}`);
    const list = heroColumn().querySelector(".sm\\:grid-cols-2");
    const counts = Array.from(list?.children ?? [], (item) => {
      const lines = Array.from(item.children);
      return {
        base: lines.filter((line) => !line.classList.contains("max-sm:hidden")).length,
        sm: lines.filter((line) => !line.classList.contains("sm:hidden")).length,
      };
    });
    // On a 390 phone every column is 314px of text.
    expect(counts.map(({ base }) => base)).toEqual([3, 1, 2, 2, 1, 3]);
    expect(counts.map(({ sm }) => sm)).toEqual(expected);
  });

  it("draws the invoice's eight 48px lines before the doors", () => {
    render(<PricingLoading />);
    const ledger = heroColumn().querySelector(".divide-y");
    expect(ledger?.children).toHaveLength(8);
    for (const row of ledger?.children ?? []) expect(row).toHaveClass("py-3");
    const door = heroColumn().querySelector(".h-12.rounded-lg");
    expect(door).not.toBeNull();
    expect(
      ledger && door ? ledger.compareDocumentPosition(door) & Node.DOCUMENT_POSITION_FOLLOWING : 0,
    ).toBeTruthy();
  });

  it("draws the figure at its 72px phone and 96px desk line", () => {
    render(<PricingLoading />);
    expect(heroColumn().querySelector(".h-18")).toHaveClass("sm:h-24");
  });
});
