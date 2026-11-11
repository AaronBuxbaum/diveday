import { expect, signedInAsOwner, test } from "./fixtures";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use(VISUAL_STEP_BOUNDS);
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, () => {
    signedInAsOwner();
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });
    test(`received purchase and recorded return (${scheme})`, async ({ page }) => {
      await page.goto("/shop/blue-mantis/orders?purchase=1");
      const form = page.getByRole("form", { name: "Record purchase", exact: true });
      await form
        .getByLabel("Customer", { exact: true })
        .selectOption({ label: "Priya Sharma · priya.sharma@mail.example" });
      await form.locator('[name="description-0"]').fill("Reef shirt");
      await form.locator('[name="unitAmount-0"]').fill("50");
      await form.getByLabel("Included tax (optional)", { exact: true }).fill("3");
      await form.getByLabel("Included tip (optional)", { exact: true }).fill("2");
      await capture(page, "recorded-purchase-filled", scheme);
      await form.getByRole("button", { name: "Record received payment", exact: true }).click();
      await page.waitForURL(/\/orders\/[0-9a-f-]{36}$/);
      await page.getByText("Record money already returned", { exact: true }).click();
      await page.getByLabel("Amount returned (USD)", { exact: true }).fill("10");
      await page.getByLabel("Reason", { exact: true }).fill("Shirt returned at the counter");
      await capture(page, "recorded-purchase-external-return", scheme);
      await page.getByRole("button", { name: "Record returned money", exact: true }).click();
      await expect(page.getByText("Shirt returned at the counter", { exact: true })).toBeVisible();
      // Persisted receipt, without the transient success notice.
      await page.goto(page.url().split("?")[0] ?? page.url());
      await capture(page, "recorded-purchase-return-history", scheme);
    });
  });
}
