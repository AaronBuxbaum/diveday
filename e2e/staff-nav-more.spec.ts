import { expect, signedInAsOwner, test } from "./fixtures";

test.describe("a new demo on a phone", () => {
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("keeps the bottom More menu usable after entering the demo", async ({ page }) => {
    await page.goto("/");
    await page.getByRole("button", { name: "Try the live demo" }).first().tap();
    await expect(page).toHaveURL(/\/shop\//);
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    const more = tabs.getByRole("button", { name: "More", exact: true });
    const money = tabs.getByRole("link", { name: "Money", exact: true });
    await more.tap();
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(money).toBeVisible();
    await money.locator("../..").evaluate(async (panel) => {
      await Promise.all(panel.getAnimations().map((animation) => animation.finished));
    });
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await money.tap();
    await expect(page).toHaveURL(/\/orders$/);
    await more.tap();
    await expect(money).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(money).toBeHidden();
  });
});

test.describe("the phone", () => {
  signedInAsOwner();
  test.use({ viewport: { width: 390, height: 844 }, hasTouch: true, isMobile: true });

  test("keeps More open after touch and supports repeated dismissal and navigation", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis");
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    const more = tabs.getByRole("button", { name: "More", exact: true });
    const money = tabs.getByRole("link", { name: "Money", exact: true });

    for (let cycle = 0; cycle < 3; cycle++) {
      await more.tap();
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await expect(money).toBeVisible();
      await money.locator("../..").evaluate(async (panel) => {
        await Promise.all(panel.getAnimations().map((animation) => animation.finished));
      });
      await expect(more).toHaveAttribute("aria-expanded", "true");
      await more.tap();
      await expect(more).toHaveAttribute("aria-expanded", "false");
      await expect(money).toBeHidden();
    }

    await more.tap();
    await expect(money).toBeVisible();
    await page.getByRole("heading", { level: 1 }).tap();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(money).toBeHidden();

    await more.tap();
    await money.tap();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.tap();
    await expect(money).toBeVisible();
    await tabs.getByRole("link", { name: "Divers", exact: true }).tap();
    await expect(page).toHaveURL(/\/divers$/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await page.goBack();
    await expect(page).toHaveURL(/\/orders$/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.tap();
    await expect(money).toBeVisible();
  });

  test("opens More with Enter and Space and returns focus on Escape", async ({ page }) => {
    await page.goto("/shop/blue-mantis");
    const tabs = page.getByRole("navigation", { name: "Main", exact: true });
    const more = tabs.getByRole("button", { name: "More", exact: true });
    const money = tabs.getByRole("link", { name: "Money", exact: true });
    await more.focus();
    await page.keyboard.press("Enter");
    await expect(money).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(money).toBeHidden();
    await expect(more).toBeFocused();
    await page.keyboard.press("Space");
    await expect(money).toBeVisible();
    await page.keyboard.press("Tab");
    await expect(money).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page).toHaveURL(/\/orders$/);
    await expect(more).toHaveAttribute("aria-expanded", "false");
  });
});
