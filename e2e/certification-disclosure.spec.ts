import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";

for (const width of [390, 1280]) {
  test.describe(`${width}px`, () => {
    test.use({
      viewport: { width, height: 844 },
      hasTouch: width === 390,
      isMobile: width === 390,
    });

    test("trip requirements have a full touch target and retain native keyboard behavior", async ({
      page,
      privateShop,
      request,
    }) => {
      await seedFacts(request, [{ name: "claudeAssists" }], { slug: privateShop.slug });
      await page.goto(`/shop/${privateShop.slug}/divers`);
      await page.getByRole("searchbox", { name: "Search divers" }).fill("Diego Alvarez");
      await page.getByRole("link", { name: /Diego Alvarez/ }).click();
      const summary = page.locator("summary").filter({ hasText: "What this trip needs" });
      await expect(summary).toBeVisible();
      const bounds = await summary.boundingBox();
      if (!bounds) throw new Error("The visible requirements disclosure has no bounding box");
      expect(bounds.height).toBeGreaterThanOrEqual(44);
      expect(bounds.width).toBeGreaterThanOrEqual(44);
      const details = summary.locator("..");
      await expect(details).not.toHaveAttribute("open", "");
      const position = { x: bounds.width / 2, y: bounds.height - 2 };
      if (width === 390) await summary.tap({ position });
      else await summary.click({ position });
      await expect(details).toHaveAttribute("open", "");
      await expect(details.getByRole("listitem").first()).toBeVisible();
      await summary.focus();
      await summary.press("Space");
      await expect(details).not.toHaveAttribute("open", "");
      await summary.press("Enter");
      await expect(details).toHaveAttribute("open", "");
      await expect(summary).toBeFocused();
    });
  });
}
