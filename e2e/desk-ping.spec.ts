import { expect, signedInAs, test } from "./fixtures";

/**
 * **The desk is pinged when divers write in after hours** (D4, Aaron
 * 2026-10-09): the shop's desk hours under Settings → Messages, and each
 * staffer's own answer to the ping on their Email settings. Who gets pinged,
 * when, and what the email says are `src/db/desk-pings.test.ts`; what is
 * pinned here is that both doors exist and save.
 *
 * Both write state the per-test reset does not restore (`shops.desk_*` and
 * `user_accounts.after_hours_ping`), so the tests that write take a shop of
 * their own (`privateShop`).
 */
const settingsFor = (shopSlug: string) => `/shop/${shopSlug}/settings`;

test.describe("the after-hours ping, on a shop of the test's own", () => {
  test("an owner hears by default and can turn it off and back on", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`${settingsFor(privateShop.slug)}/email`);
    const card = page.getByRole("region", { name: "After-hours messages" });
    await expect(card.getByText(/outside desk hours, 8:00\s?AM to 6:00\s?PM/)).toBeVisible();
    await expect(card.getByText("On", { exact: true })).toBeVisible();

    await card.getByRole("button", { name: "Turn off" }).click();
    await expect(card.getByRole("button", { name: "Turn on" })).toBeVisible();
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    // The Monday email beside it is its own answer, untouched.
    await expect(
      page.getByRole("region", { name: "Monday email" }).getByText("On", { exact: true }),
    ).toBeVisible();

    await page.reload();
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    await card.getByRole("button", { name: "Turn on" }).click();
    await expect(card.getByText("On", { exact: true })).toBeVisible();
  });

  test("the shop sets its desk hours, and a closing before the opening is refused", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    // The fragment opens the row by itself (`AutoOpenDetails`).
    await page.goto(`${settingsFor(privateShop.slug)}#desk-hours`);
    await expect(page.getByLabel("Opens")).toBeVisible();
    await page.getByLabel("Opens").fill("07:30");
    await page.getByLabel("Closes").fill("17:00");
    await page.getByRole("button", { name: "Save desk hours" }).click();
    await expect(page).toHaveURL(/notice=desk-hours-saved/);
    await expect(page.getByText("Desk hours saved.")).toBeVisible();

    await page.getByLabel("Opens").fill("19:00");
    await page.getByRole("button", { name: "Save desk hours" }).click();
    await expect(page).toHaveURL(/notice=desk-hours-invalid/);
    await expect(page.getByText("Pick an opening time before the closing time.")).toBeVisible();

    // The staffer's own Email settings read the shop's hours back.
    await page.goto(`${settingsFor(privateShop.slug)}/email`);
    await expect(
      page
        .getByRole("region", { name: "After-hours messages" })
        .getByText(/7:30\s?AM to 5:00\s?PM/),
    ).toBeVisible();
  });
});

test.describe("the after-hours ping for a staffer who is not an owner", () => {
  signedInAs("divemaster");

  test("is off by default", async ({ page }) => {
    await page.goto(`${settingsFor("blue-mantis")}/email`);
    const card = page.getByRole("region", { name: "After-hours messages" });
    await expect(card.getByText("Off", { exact: true })).toBeVisible();
    await expect(card.getByRole("button", { name: "Turn on" })).toBeVisible();
  });
});
