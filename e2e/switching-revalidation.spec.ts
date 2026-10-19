import { expect, test } from "./fixtures";

test.describe("Partial prefetching revalidation (#2546)", () => {
  test("/switching/eve answers 200 and renders its guide content cleanly", async ({ page }) => {
    const res = await page.goto("/switching/eve");
    expect(res?.status()).toBe(200);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(page.getByText(/Eve/i).first()).toBeVisible();
  });
});
