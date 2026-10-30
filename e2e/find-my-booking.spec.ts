import { expect, makeActivitySafe, test } from "./fixtures";
import { createTrip, daysFromNow, e2eNow, openTripFromBoard } from "./helpers";

const ownerTest = test.extend({
  storageState: async ({ staffStorageState }, use) => {
    await use(await staffStorageState("owner"));
  },
});

/**
 * "Can't find your link?" (issue #723) — the public re-send door for a diver
 * whose confirmation email never arrived. The whole feature is one security
 * property: the confirmation must read identically whether or not the typed
 * address has a booking here. That is what these two tests exist to pin —
 * not "an email went out", which the e2e fleet has no provider to observe
 * (every other resend spec in this suite stops at the same boundary).
 */

ownerTest(
  "a diver with a booking sees the same confirmation as one who has none",
  async ({ browser, page }) => {
    ownerTest.setTimeout(30_000);
    const email = `nora-fmb-${e2eNow().getTime()}@example.com`;
    const title = `Find My Booking Test Trip ${e2eNow().getTime()}`;

    await createTrip(page, { title, date: daysFromNow(3), departsAt: "09:00", returnsAt: "11:00" });
    await page.goto("/shop/blue-mantis/schedule/board");
    await openTripFromBoard(page, title);
    await page.getByRole("link", { name: "Add diver" }).click();
    await page.waitForURL(/\/divers\/new/);
    await page.getByLabel("Full name").fill("Nora Quinn");
    await page.getByLabel("Email").fill(email);
    await page.getByRole("button", { name: "Add to trip" }).click();
    await page.waitForURL(/\/trips\/[^/?#]+(?:[?#]|$)/);

    // This is a public recovery flow. Keep its anonymous visitor separate from
    // staff setup so the assertion does not depend on the header's sign-out UI.
    const diverContext = await browser.newContext({ storageState: { cookies: [], origins: [] } });
    const diverPage = makeActivitySafe(await diverContext.newPage());
    try {
      await diverPage.goto("/s/blue-mantis");
      const findMyBooking = diverPage.locator("#find-my-booking");
      await findMyBooking.getByText("Can’t find your link?").click();
      await findMyBooking.getByLabel("Email").fill(email);
      await findMyBooking.getByRole("button", { name: "Send my link" }).click();
      await expect(diverPage.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
      const matchedBody = await diverPage
        .getByText("If that email has a current booking with us, we’ve sent a fresh link to it.")
        .textContent();

      await diverPage.goto("/s/blue-mantis");
      const secondAttempt = diverPage.locator("#find-my-booking");
      await secondAttempt.getByText("Can’t find your link?").click();
      await secondAttempt.getByLabel("Email").fill(`nobody-fmb-${e2eNow().getTime()}@example.com`);
      await secondAttempt.getByRole("button", { name: "Send my link" }).click();
      await expect(diverPage.getByRole("heading", { name: "Check your inbox" })).toBeVisible();
      const unmatchedBody = await diverPage
        .getByText("If that email has a current booking with us, we’ve sent a fresh link to it.")
        .textContent();

      expect(unmatchedBody).toBe(matchedBody);
    } finally {
      await diverContext.close();
    }
  },
);

test("the form is collapsed by default and asks for nothing but an email", async ({ page }) => {
  await page.goto("/s/blue-mantis");
  const findMyBooking = page.locator("#find-my-booking");
  await expect(findMyBooking.getByLabel("Email")).toBeHidden();
  await findMyBooking.getByText("Can’t find your link?").click();
  await expect(findMyBooking.getByLabel("Email")).toBeVisible();
  await expect(findMyBooking.getByRole("button", { name: "Send my link" })).toBeVisible();
});

/**
 * **DiveDay's door for a diver** (fourth review, item 50): a diver who lost
 * their link and searched for DiveDay lands on the home page, which is for shop
 * owners. One quiet line there leads to a picker of listed shops, and each
 * shop leads to its own find-my-booking row, open on arrival.
 */
test("a diver on DiveDay's home page finds their way to a shop's find-my-booking", async ({
  page,
}) => {
  await page.goto("/");
  await page.getByRole("link", { name: "Find your booking" }).click();
  await page.waitForURL(/\/find-your-booking$/);
  await expect(page.getByRole("heading", { level: 1, name: "Find your booking" })).toBeVisible();
  const shops = page.getByRole("list", { name: "Shops on DiveDay" });
  // A listed shop only: the demo never appears on a public list.
  await expect(shops.getByRole("link", { name: /Blue Mantis/ })).toHaveCount(0);
  await shops.getByRole("link", { name: /Reef Line Divers/ }).click();
  await page.waitForURL(/\/s\/reef-line-divers#find-my-booking$/);
  await expect(page.locator("#find-my-booking").getByLabel("Email")).toBeVisible();
});

test("the shop header reveals the existing recovery form when its link is clicked", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto("/s/blue-mantis");
  const recovery = page.locator("details#find-my-booking");
  await expect(recovery).not.toHaveAttribute("open");
  await page.getByRole("link", { name: "Find my booking", exact: true }).click();
  await expect(page).toHaveURL(/\/s\/blue-mantis#find-my-booking$/);
  await expect(recovery).toHaveAttribute("open", "");
  await expect(recovery.getByRole("textbox", { name: "Email" })).toBeVisible();
  await recovery.locator("summary").click();
  await expect(recovery).not.toHaveAttribute("open");
  await page.getByRole("link", { name: "Find my booking", exact: true }).click();
  await expect(recovery).toHaveAttribute("open", "");
  await expect(recovery.getByRole("textbox", { name: "Email" })).toBeInViewport();
});
