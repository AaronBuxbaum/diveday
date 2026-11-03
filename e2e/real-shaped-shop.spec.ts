import { expect, test } from "./fixtures";

/**
 * **A shop with `is_demo` off can be signed into and rendered** (issue #2783).
 * `is_demo` is a visitor's playground (banner, role switcher, bypass); a
 * fixture is a property of the process. `privateShopDemo: false` mints the
 * real-shaped shop and the harness's `fixtureSignIn` admits its owner, so the
 * non-demo branches (no demo banner here) have a shop to render on. The bypass
 * itself stays shut with a database configured: `demo-bypass.test.ts`.
 */
test.describe("a real-shaped shop", () => {
  test.use({ privateShopDemo: false });

  test("signs its owner in and wears no demo banner", async ({ page, privateShop }) => {
    await page.goto(`/shop/${privateShop.slug}`);
    await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}`));
    await expect(page.getByRole("main")).toBeVisible();
    await expect(page.getByText("Viewing as")).toHaveCount(0);
  });
});
