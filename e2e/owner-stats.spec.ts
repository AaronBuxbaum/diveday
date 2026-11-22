import { expect, READ_ONLY, signedInAsOwner, test } from "./fixtures";

/** **The owner's stats** (issue #4262): a tab of Money that reads the shop's own rows. Read-only. */
test.describe("owner stats", () => {
  signedInAsOwner();

  test("an owner reaches the stats from Money and reads four figures", { tag: READ_ONLY }, async ({
    page,
  }) => {
    await page.goto("/shop/blue-mantis/reports");
    await page.getByRole("link", { name: "Stats", exact: true }).click();
    await expect(page).toHaveURL(/\/shop\/blue-mantis\/stats/);
    await expect(page.getByRole("heading", { level: 1, name: "Money" })).toBeVisible();
    const figures = page.getByRole("region", { name: "The last 12 months" });
    for (const label of [
      "Repeat divers",
      "Waivers in by departure",
      "Waivers in the day before",
      "Medical review time",
    ]) {
      await expect(figures.getByText(label, { exact: true })).toBeVisible();
    }
  });
});
