import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

const staffCopy = staffTranslator("en-US");
signedInAsOwner();

async function expectContained(page: Page) {
  const panel = page.locator("[data-row-menu]");
  await expect(panel).toBeVisible();
  await expect
    .poll(() =>
      panel.evaluate((element) => {
        const box = element.getBoundingClientRect();
        return Math.min(box.left, document.documentElement.clientWidth - box.right);
      }),
    )
    .toBeGreaterThanOrEqual(0);
  await expect(page.getByRole("link", { name: "Download record" })).toBeInViewport({ ratio: 1 });
  await expect(page.getByRole("button", { name: "Delete diver" })).toBeInViewport({ ratio: 1 });
}

for (const width of [390, 1280]) {
  test.describe(`diver record menu at ${width}px`, () => {
    test.use({ viewport: { width, height: 844 }, hasTouch: true });

    test("record actions remain reachable through touch, keyboard, dismissal and resizing", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/divers?q=Priya");
      await page.getByRole("link", { name: "Priya Sharma", exact: true }).click();
      await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
      const trigger = page.getByRole("button", { name: "Record actions" });
      const booking = page.locator("summary", {
        hasText: staffCopy("divers.bookActivity.bookDeparture"),
      });
      await booking.tap();
      await trigger.tap();
      await expectContained(page);
      await trigger.tap();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.focus();
      await page.keyboard.press("Enter");
      const download = page.getByRole("link", { name: "Download record" });
      await expect(download).toBeFocused();
      await expectContained(page);
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.tap();
      // Tap outside the floating panel, then verify the booking control still acts.
      await page.getByRole("heading", { level: 1, name: "Priya Sharma" }).tap();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await booking.tap();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");
      await expect(
        page.getByRole("combobox", { name: staffCopy("divers.bookActivity.courseOrDiveLabel") }),
      ).toBeHidden();
      await booking.tap();
      await trigger.tap();
      for (const nextWidth of [320, 1280, 390]) {
        await page.setViewportSize({ width: nextWidth, height: 844 });
        await expectContained(page);
      }
      const downloaded = page.waitForEvent("download");
      await download.click();
      const file = await downloaded;
      expect(file.suggestedFilename()).toMatch(/\.zip$/);
      expect(await file.failure()).toBeNull();
      await expect(trigger).toHaveAttribute("aria-expanded", "false");

      await trigger.tap();
      const confirmation = page.waitForEvent("dialog");
      page.once("dialog", (dialog) => void dialog.dismiss());
      await page.getByRole("button", { name: "Delete diver" }).tap();
      expect((await confirmation).type()).toBe("confirm");
      await expect(page.getByRole("heading", { level: 1, name: "Priya Sharma" })).toBeVisible();
      await page.keyboard.press("Escape");
      await expect(trigger).toBeFocused();
      await trigger.tap();
      await expectContained(page);
    });
  });
}
