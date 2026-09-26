// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import KioskCheckInLoading from "./loading";

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
