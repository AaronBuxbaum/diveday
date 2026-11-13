import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

for (const width of [390, 1280]) {
  test.describe(`${width}px`, () => {
    test.use({ viewport: { width, height: 844 } });
    test("a keyboard reader can hold a timed refusal and its field description survives expiry", async ({
      page,
      privateShop,
    }) => {
      const t = staffTranslator("en-US");
      await page.clock.install({ time: E2E_FROZEN_CLOCK });
      await page.goto(`/shop/${privateShop.slug}/boats`);
      const row = page.locator('details[id^="boat-"]:not(#boat-new)').first();
      await row.locator("summary").click();
      const channel = row.getByLabel(t("boats.workingChannelLabel"));
      await channel.fill("16");
      const submit = row.getByRole("button", { name: t("boats.submit"), exact: true });
      await submit.click();
      const toast = page.getByRole("alert").and(page.locator('[tabindex="0"]'));
      await expect(toast).toHaveText(t("boats.boatChannelDistress"));
      await expect(channel).toHaveAttribute("aria-invalid", "true");
      await submit.focus();
      await page.keyboard.press("Shift+Tab");
      await expect(toast).toBeFocused();
      await page.clock.fastForward(31_000);
      await expect(toast).toBeVisible();
      await submit.focus();
      await page.clock.fastForward(8000);
      await expect(toast).toHaveClass(/toast-dismiss/);
      await page.clock.fastForward(1000);
      await expect(toast).toHaveCount(0);
      await expect(channel).toHaveAttribute("aria-invalid", "true");
      const ids = (await channel.getAttribute("aria-describedby"))?.split(/\s+/) ?? [];
      expect(ids.length).toBeGreaterThan(0);
      for (const id of ids) await expect(page.locator(`[id="${id}"]`)).toHaveCount(1);
      await expect(channel).toHaveAccessibleDescription(
        new RegExp(t("boats.boatChannelDistress").replace(/[.*+?^${}()|[\]\\]/g, "\\$&")),
      );
    });
  });
}
