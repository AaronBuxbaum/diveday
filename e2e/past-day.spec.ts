import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";
import { daysFromNow } from "./helpers";

const staff = staffTranslator("en-US");

/**
 * **A past day, read-only** (issue #2662): `/shop/<shop>/schedule/day/<date>`
 * draws how that day's boats closed, the home's evening stations with nothing
 * to do on them, under Schedule. Read-only, on the shared blue-mantis fixture,
 * whose seed sails boats on the days before the frozen clock.
 */
test.describe("a past day", () => {
  signedInAsOwner();

  test("reads yesterday's boats as they closed, under Schedule", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto(`/shop/blue-mantis/schedule/day/${daysFromNow(-1)}`);
    await expect(page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(
      page.getByRole("heading", { level: 2, name: staff("shopHome.spine.departuresLabel") }),
    ).toBeVisible();
    // A settled station, and nothing on it to write: no recap editor.
    await expect(
      page.getByRole("listitem").getByRole("heading", { level: 3 }).first(),
    ).toBeVisible();
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });

  test("sends today to the shop home", { tag: READ_ONLY }, async ({ page }) => {
    await page.goto(`/shop/blue-mantis/schedule/day/${daysFromNow(0)}`);
    await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
  });
});
