import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, signedInAsOwner, test } from "./fixtures";

signedInAsOwner();

const staff = staffTranslator("en-US");

// **An ordinary staff screen prints nothing but a line** (issue #2745): a
// document is a sheet and a screen never prints.
test.describe("an ordinary staff screen on paper", () => {
  test("prints the line that points at the Print buttons, and none of the screen", async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/promos");
    const heading = page.getByRole("heading", { level: 1 });
    await expect(heading).toBeVisible();
    const notice = page.locator("[data-staff-print-notice]");
    await expect(notice).not.toBeVisible();
    await page.emulateMedia({ media: "print" });
    await expect(notice).toBeVisible();
    await expect(notice).toHaveText(staff("shared.printNotice"));
    await expect(heading).not.toBeVisible();
  });

  test("leaves a page that holds a sheet to its sheet", async ({ page }) => {
    await page.goto("/shop/blue-mantis/print");
    await page.emulateMedia({ media: "print" });
    await expect(page.locator(".paper-sheet").first()).toBeVisible();
    await expect(page.locator("[data-staff-print-notice]")).not.toBeVisible();
  });
});
