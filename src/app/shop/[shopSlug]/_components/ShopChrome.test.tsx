// @vitest-environment jsdom

import { render } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ShopChromeSkeleton, ShopSidebarSkeleton } from "./ShopChrome";

/**
 * **The staff chrome's stand-ins say they are stand-ins** (issue #2514).
 *
 * The header band and the sidebar stream in behind their own boundaries, above
 * and beside `<main>`, so a visual capture's wait for the page's skeleton
 * cannot see them. `capture()` in `e2e/visual.spec.ts` also waits for every
 * `[data-suspense-placeholder]` to leave; without the mark, `today-empty` at
 * 390 was shot on one run with the bare band where the header goes and no tab
 * bar (62px shorter, the tab bar's pad gone with it) and with both on the next.
 */
describe("the staff chrome's fallbacks", () => {
  it("marks the header band as a placeholder", () => {
    const { container } = render(<ShopChromeSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("data-suspense-placeholder");
  });

  it("marks the sidebar's held width as a placeholder", () => {
    const { container } = render(<ShopSidebarSkeleton />);
    expect(container.firstElementChild).toHaveAttribute("data-suspense-placeholder");
  });
});
