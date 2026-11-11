import { diverTranslator } from "../src/i18n/messages";
import { expect, makeActivitySafe, test } from "./fixtures";
import { bookUnnamedVisualGroup } from "./visual-harness";

const diver = diverTranslator("en-US");

test("one group link lets each companion choose and claim their own seat", async ({
  page,
  browser,
  workerBaseURL,
}) => {
  // Public booking followed by an independent browser's claim and refreshed picker.
  test.setTimeout(60_000);
  const groupPath = await bookUnnamedVisualGroup(page);
  await expect(page.getByText(diver("seatClaim.atShopSummary"))).toBeVisible();
  const claimant = await browser.newContext({ baseURL: workerBaseURL });
  try {
    const guest = makeActivitySafe(await claimant.newPage());
    await guest.goto(groupPath);
    await expect(
      guest.getByRole("heading", { name: diver("seatClaim.groupHeading") }),
    ).toBeVisible();
    await expect(guest.getByRole("link", { name: "Guest 3", exact: true })).toBeVisible();
    await guest.getByRole("link", { name: "Guest 2", exact: true }).click();
    await guest.getByLabel("Your name").fill("Group Companion");
    await guest.getByLabel("Your email").fill("group-companion@example.com");
    await guest.getByRole("button", { name: "Claim this seat" }).click();
    await expect(
      guest.getByRole("heading", { name: diver("seatClaim.claimedHeading") }),
    ).toBeVisible();
    await guest.goto(groupPath);
    await expect(guest.getByRole("link", { name: "Guest 3", exact: true })).toBeVisible();
    await expect(guest.getByRole("link", { name: "Guest 2", exact: true })).toHaveCount(0);
    await expect(guest.locator('a[href^="/ready/"]')).toHaveCount(0);
  } finally {
    await claimant.close();
  }
});
