import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow } from "./helpers";

signedInAsOwner();

test("staff adds a walk-in diver, then wait-lists one once the trip is full", async ({ page }) => {
  // Unique per run: the dev database persists across e2e runs.
  const title = `Walk-in Test Trip ${Date.now()}`;

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("1");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Staff view of a trip card redirects straight into the manage-trip editor.
  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();

  const addDiver = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Add a diver" }) });
  await addDiver.scrollIntoViewIfNeeded();
  await addDiver.getByLabel("Name").fill("Walk-in Wanda");
  await addDiver.getByLabel("Email").fill(`wanda-${Date.now()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to trip" }).click();

  await expect(page.getByRole("status")).toContainText("Diver added to the trip.");
  await expect(page.getByText("Walk-in Wanda")).toBeVisible();
  await expect(page.getByText("Full", { exact: true })).toBeVisible();

  // Trip is now full — the same section switches to wait-listing.
  await expect(addDiver.getByRole("button", { name: "Add to wait list" })).toBeVisible();
  await addDiver.getByLabel("Name").fill("Waitlist Wally");
  await addDiver.getByLabel("Email").fill(`wally-${Date.now()}@example.com`);
  await addDiver.getByRole("button", { name: "Add to wait list" }).click();

  await expect(page.getByRole("status")).toContainText("Diver added to the wait list.");
  await expect(page.getByText("Wait list").first()).toBeVisible();
  await expect(page.getByText("Waitlist Wally")).toBeVisible();

  // One-tap seat recovery: inviting the next-in-line stamps the entry so a
  // second staffer sees it's already handled. The button opens the mail
  // composer (mailto:) which the test can't follow, so we only assert the
  // recorded state lands.
  const waitlist = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Wait list" }) });
  await waitlist.getByRole("button", { name: /Email .* an invite/ }).click();
  await expect(waitlist.getByText(/Invited/)).toBeVisible();
  await expect(waitlist.getByRole("button", { name: "Re-send invite" })).toBeVisible();
});
