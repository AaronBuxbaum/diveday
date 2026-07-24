import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow, e2eNow } from "./helpers";

signedInAsOwner();

test("a repeating series is scheduled, then rolled forward and cancelled as one", async ({
  page,
}) => {
  // Unique title so the assertions target this spec's own series.
  const title = `Series Test ${e2eNow().getTime()}`;

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:00");
  await page.getByLabel("Capacity").fill("6");
  await page.getByLabel("How often").selectOption("1");
  await page.getByLabel("Number of trips").fill("3");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toContainText(title);

  // Open the first instance and confirm the series controls are present.
  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: title }).first().click();
  await expect(page.getByRole("heading", { level: 1, name: title })).toBeVisible();
  const tripUrl = page.url();
  const series = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Repeating series" }) });
  await expect(series).toBeVisible();

  // Roll the horizon forward by two dates.
  await series.getByLabel("How many more dates to add").fill("2");
  await series.getByRole("button", { name: "Add to the schedule" }).click();
  await expect(page.getByRole("status")).toContainText("Added more dates");

  // Reload to clear the extend notice, then cancel every upcoming date at once.
  await page.goto(tripUrl);
  await page.getByRole("button", { name: "Cancel every upcoming date" }).click();
  await expect(page.getByText(/Cancelled every upcoming date in this series/)).toBeVisible();
});
