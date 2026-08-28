import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/**
 * READ_ONLY holds here: the only submit is the orders toolbar, which is a GET form.
 */

/**
 * Applying a filter must not move the reader.
 *
 * The orders toolbar is a `<form method="get">`, and a native GET submit is a
 * full document navigation — the browser tears the page down, re-runs the
 * shell, and lands at scroll top. `QueryForm` keeps the form a real GET form
 * (so a submit landing before hydration is not lost) and turns the submit into
 * a router navigation. This is the assertion that the difference
 * is real: it needs a live viewport with content below the fold, which is
 * neither a screenshot nor a unit test.
 *
 * Since the ledger recomposition (ADR 20260827-clearwater-surface-language,
 * slice 6f) the toolbar applies on change and carries no Apply button, so the
 * select *is* the submit — which makes this the more honest version of the
 * same test.
 *
 * Note for whoever extends this: `locator.click()` scrolls its target into
 * view first, which on a long page moves the very thing under test. Position
 * the page so the control is already comfortably on screen, and read the
 * scroll position *after* the URL settles.
 */
test.describe("staying put", () => {
  signedInAsOwner();

  test("applying an orders filter leaves the reader where they were", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto("/shop/blue-mantis/orders");
    // The deterministic signal that apply-on-change is live: before hydration
    // a select still submits natively, which is exactly what this test is
    // about not doing.
    await page.locator('#orders-search[data-hydrated="true"]').waitFor();
    const before = await page.evaluate(() => {
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      window.scrollTo(0, Math.min(700, scrollable));
      return { y: window.scrollY, scrollable };
    });
    expect(before.y).toBeGreaterThan(400);

    await page.getByLabel("Status").selectOption("paid");
    await expect(page).toHaveURL(/status=paid/);

    const after = await page.evaluate(() => ({
      y: window.scrollY,
      scrollable: document.documentElement.scrollHeight - window.innerHeight,
    }));
    expect(after.y).toBeGreaterThan(Math.min(before.y, after.scrollable) - 60);
  });
});
