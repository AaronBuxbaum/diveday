import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * Applying a filter must not move the reader.
 *
 * The orders filter band is a `<form method="get">`, and a native GET submit
 * is a full document navigation — the browser tears the page down, re-runs the
 * shell, and lands at scroll top. `QueryForm` keeps the form a real GET form
 * (so it still works before hydration and with JavaScript off) and turns the
 * submit into a router navigation. This is the assertion that the difference
 * is real: it needs a live viewport with content below the fold, which is
 * neither a screenshot nor a unit test.
 *
 * Note for whoever extends this: `locator.click()` scrolls its target into
 * view first, which on a long page moves the very thing under test. Position
 * the page so the control is already comfortably on screen, and read the
 * scroll position *after* the URL settles.
 */
test.describe("staying put", () => {
  signedInAsOwner();

  test("applying an orders filter leaves the reader where they were", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop/blue-mantis/orders");
    await expect(page.getByRole("button", { name: "Apply filters" })).toBeVisible();
    const before = await page.evaluate(() => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(700, scrollable));
      return { y: window.scrollY, scrollable };
    });
    expect(before.y).toBeGreaterThan(400);

    await page.getByLabel("Status").selectOption("paid");
    await page.getByRole("button", { name: "Apply filters" }).click();
    await expect(page).toHaveURL(/status=paid/);

    const after = await page.evaluate(() => ({
      y: window.scrollY,
      scrollable: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(after.y).toBeGreaterThan(Math.min(before.y, after.scrollable) - 60);
  });
});
