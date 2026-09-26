// @vitest-environment jsdom
import { readFileSync } from "node:fs";
import path from "node:path";
import { cleanup, render } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { PublicShopMainContent } from "./PublicShopMainContent";

afterEach(cleanup);

const SHOP_SEGMENT = path.join(import.meta.dirname, "..");
const APP = path.join(SHOP_SEGMENT, "..", "..");

/**
 * **The shop's main region is a column, so a page inside it can fill it.**
 *
 * The body is a flex column and this region takes its spare height
 * (`flex-1`), but it was a block box: a page's own `flex-1` did nothing inside
 * it, and a page that asks to centre itself in the space between the shop's
 * header and footer centred within its own height instead. The pixel probe
 * measured the shop's 404 70px under the header and 407px over the footer at
 * 1280. The root layout's `#main-content` is the same column one level up.
 */
describe("the public shop's main region", () => {
  it("is a flex column that fills the height the page frame leaves", () => {
    const { container } = render(
      <PublicShopMainContent>
        <main>page</main>
      </PublicShopMainContent>,
    );
    const region = container.firstElementChild;
    expect(region).toHaveAttribute("id", "public-shop-main-content");
    expect(region).toHaveAttribute("tabindex", "-1");
    expect(region).toHaveClass("flex", "flex-1", "flex-col", "outline-none");
  });

  /**
   * Two files frame a shop's page: the segment layout, and the root 404 that
   * composes the same frame for a dead link the edge refused. The region was
   * spelled in each, which is how a fix to one would have missed the other.
   */
  it("is spelled once, and both frames render it", () => {
    for (const file of [path.join(SHOP_SEGMENT, "layout.tsx"), path.join(APP, "not-found.tsx")]) {
      const source = readFileSync(file, "utf8");
      expect(source, file).toContain("<PublicShopMainContent>");
      expect(source, file).not.toContain('id="public-shop-main-content"');
    }
  });
});
