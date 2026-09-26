// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import OrderLoading from "./loading";

afterEach(cleanup);

/**
 * **The receipt card's skeleton sits where the receipt will** (docs/design/
 * pixel-craft.md, class 11: 0px of shift on load; K-244).
 *
 * The order's header always carries a `meta` line ("Raised … · by … · Diver
 * record"), a 20px `text-sm` line in the header's `mt-3`. The skeleton drew no
 * bar for it, so the card appeared 32px high and dropped when the order
 * arrived: 297 against 329 at 1280, 343 against 375 at 390.
 */
const PAGE = readFileSync(join(import.meta.dirname, "page.tsx"), "utf8");
const PAGE_HEADER = PAGE.slice(PAGE.indexOf("<ShopPageHeader"), PAGE.indexOf("<SectionCard"));

/** The header skeleton: the pulse's first child, the one that owns the `mb-8`. */
function headerOf(container: HTMLElement) {
  return container.querySelector(".animate-pulse > .mb-8");
}

describe("the order's loading skeleton", () => {
  it("draws the meta line the order's header always carries", () => {
    expect(PAGE_HEADER).toMatch(/\bmeta=\{/);
    const { container } = render(<OrderLoading />);
    // One `h-5` bar, a `text-sm` line's box, in the header's `mt-3` slot.
    expect(headerOf(container)?.querySelector(":scope > .mt-3 > .h-5")).not.toBeNull();
  });

  it("leaves the gap above the receipt to the header's own mb-8", () => {
    // A margin on the card collapses into the header's `mb-8` and does
    // nothing but suggest a gap the page does not draw.
    const { container } = render(<OrderLoading />);
    const card = headerOf(container)?.nextElementSibling;
    expect(card).not.toBeNull();
    expect(card).not.toHaveClass("mt-8");
  });
});
