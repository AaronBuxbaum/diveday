// @vitest-environment jsdom
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import DiveSitesLoading from "./loading";

afterEach(cleanup);

/**
 * **The library's skeleton is the library's shape** (docs/design/pixel-craft.md,
 * class 11: 0px of shift on load; K-415).
 *
 * It drew a 96px card where the loaded page has its one search box, a 48px
 * `md` `SearchField` in a toolbar, and rows of a 20px name over a 16px meta
 * line, 56px a row where the loaded `LedgerRow` is a 24px name over a 20px
 * meta line, 63px — so the list jumped up on arrival and every row under it
 * grew.
 */
describe("the dive-site library's loading skeleton", () => {
  it("draws the search box where the page has it, and no card", () => {
    const { container } = render(<DiveSitesLoading />);
    expect(container.querySelector(".rounded-panel")).toBeNull();
    // The header's own phone door bar is `h-12` too, inside the header block.
    const search = container.querySelectorAll(".animate-pulse > .h-12");
    expect(search).toHaveLength(1);
    expect(search[0]).toHaveClass("mb-6", "w-full", "sm:w-80", "rounded-lg");
  });

  it("draws every row at the loaded row's height, a name line over a meta line", () => {
    const { container } = render(<DiveSitesLoading />);
    const rows = [...container.querySelectorAll("*")].filter((element) =>
      element.classList.contains("last:border-b"),
    );
    expect(rows.length).toBeGreaterThan(0);
    for (const row of rows) {
      expect(row).toHaveClass("min-h-13");
      const stack = row.querySelector(".py-2");
      expect(stack?.children[0]).toHaveClass("h-6");
      expect(stack?.children[1]).toHaveClass("mt-0.5", "h-5");
    }
  });
});
