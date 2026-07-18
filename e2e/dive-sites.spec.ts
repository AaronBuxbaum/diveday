import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

function daysFromNow(days: number): string {
  return new Date(Date.now() + days * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

test("staff reuses a dive-site briefing on a trip that divers can explore", async ({ page }) => {
  const siteName = `Turtle Garden ${Date.now()}`;
  const tripTitle = `Turtle Garden charter ${Date.now()}`;

  await signInAsOwner(page);
  await page.getByRole("link", { name: "Dive sites" }).click();
  await page.getByRole("link", { name: "Create a site" }).click();
  await page.getByLabel("Name").fill(siteName);
  await page.getByLabel("Location").fill("Key Largo");
  await page.getByLabel("What might divers see?").fill("Green turtles · spotted eagle rays");
  await page
    .getByLabel("Underwater briefing")
    .fill("Look along the sandy edge for turtles resting below the coral heads.");
  await page.getByRole("button", { name: "Save site briefing" }).click();
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible();

  await page.getByRole("button", { name: "Copy and tailor" }).click();
  await expect(page.getByText("Independent copy ready to tailor.")).toBeVisible();
  await expect(page.getByRole("heading", { name: `${siteName} copy` })).toBeVisible();

  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Title").fill(tripTitle);
  await page.getByLabel("Dive site").selectOption({ label: siteName });
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await page.getByRole("link", { name: new RegExp(tripTitle) }).click();

  await page.getByLabel("Conditions overview").fill("Warm water and an easy morning are expected.");
  await page.getByLabel("Water temp °C").fill("27");
  await page.getByLabel("Visibility metres").fill("18");
  await page.getByRole("button", { name: "Save conditions" }).click();
  await expect(page.getByRole("status")).toContainText("conditions briefing updated");

  await page.goto("/shop/blue-mantis/schedule");
  await page.locator("li").filter({ hasText: tripTitle }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: siteName })).toBeVisible();
  await expect(page.getByText("Green turtles · spotted eagle rays")).toBeVisible();
  await expect(page.getByText("27°C")).toBeVisible();
  await expect(page.getByText("18 m")).toBeVisible();
});
