import { expect, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

async function signInAsOwner(page: import("@playwright/test").Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

function daysFromNow(days: number): string {
  const d = new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  return d.toISOString().slice(0, 10);
}

test("staff schedules a trip and it appears on shop and public schedules", async ({ page }) => {
  // Unique per run: the dev database persists across e2e runs.
  const title = `Turtle Reef Special ${Date.now()}`;

  await signInAsOwner(page);
  await page.getByRole("link", { name: "Schedule a trip" }).click();
  await expect(page.getByRole("heading", { name: "Schedule a trip" })).toBeVisible();

  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(3));
  await page.getByLabel("Departs").fill("09:00");
  await page.getByLabel("Returns").fill("12:30");
  await page.getByLabel("Capacity").fill("8");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page).toHaveURL(/\/shop\?created=/);
  await expect(page.getByRole("status")).toContainText(title);
  await expect(page.getByRole("heading", { name: title })).toBeVisible();

  await page.goto("/trips");
  const card = page.locator("li").filter({ hasText: title });
  await expect(card).toBeVisible();
  await expect(card.getByText("8 spots left")).toBeVisible();
});

test("end-before-start is rejected with a friendly message", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/trips/new");
  await page.getByLabel("Title").fill("Backwards Trip");
  await page.getByLabel("Date").fill(daysFromNow(4));
  await page.getByLabel("Departs").fill("12:00");
  await page.getByLabel("Returns").fill("09:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();

  await expect(page.getByRole("alert").filter({ hasText: "end after it starts" })).toBeVisible();
  await page.goto("/trips");
  await expect(page.getByRole("heading", { name: "Backwards Trip" })).not.toBeVisible();
});
