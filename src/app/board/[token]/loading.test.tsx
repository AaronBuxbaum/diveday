// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import BoardLoading from "./loading";

afterEach(cleanup);

/** The page's own header classes, read from its source: the page needs a token and a database. */
const PAGE_HEADER =
  readFileSync(join(import.meta.dirname, "page.tsx"), "utf8").match(
    /<header\s+className="([^"]+)"/,
  )?.[1] ?? "";

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
});
