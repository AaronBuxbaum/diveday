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

test("full loop: staff schedules, visitor books, staff sees the roster", async ({ page }) => {
  const title = `Eagle Ray Run ${Date.now()}`;

  // Staff puts a trip on the board.
  await signInAsOwner(page);
  await page.goto("/shop/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(5));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("11:30");
  await page.getByLabel("Capacity").fill("6");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page).toHaveURL(/\/shop\?created=/);
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/$/);

  // A visitor books it from the public schedule — no account.
  await page.goto("/trips");
  await page.locator("li").filter({ hasText: title }).getByRole("link").click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("6 spots left")).toBeVisible();
  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill(`nora-${Date.now()}@example.com`);
  await page.getByRole("button", { name: "Book my spot" }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  // The spot is held: schedule now shows one fewer.
  await page.goto("/trips");
  const card = page.locator("li").filter({ hasText: title });
  await expect(card.getByText("5 spots left")).toBeVisible();

  // Staff sees the diver on the roster.
  await signInAsOwner(page);
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await expect(page.getByRole("heading", { name: title })).toBeVisible();
  await expect(page.getByText("Nora Quinn")).toBeVisible();
});

test("a full boat shows the sold-out state instead of a form", async ({ page }) => {
  await page.goto("/trips");
  // Seeded wreck trip ships full (10 of 10).
  await page
    .locator("li")
    .filter({ hasText: "Wreck Trip — Spiegel Grove" })
    .getByRole("link")
    .click();
  await expect(page.getByRole("heading", { name: "This boat's full" })).toBeVisible();
  await expect(page.getByLabel("Name")).not.toBeVisible();
});

test("staff edits a trip and cancelling removes it from the public schedule", async ({ page }) => {
  const title = `Drift Dive ${Date.now()}`;
  const renamed = `${title} (PM)`;

  await signInAsOwner(page);
  await page.goto("/shop/trips/new");
  await page.getByLabel("Title").fill(title);
  await page.getByLabel("Date").fill(daysFromNow(6));
  await page.getByLabel("Departs").fill("13:00");
  await page.getByLabel("Returns").fill("16:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page).toHaveURL(/\/shop\?created=/);

  // Edit the title from the manage page.
  await page.getByRole("link", { name: new RegExp(title) }).click();
  await page.getByLabel("Title").fill(renamed);
  await page.getByRole("button", { name: "Save changes" }).click();
  await expect(page.getByRole("status")).toContainText("Changes saved");
  await expect(page.getByRole("heading", { name: renamed })).toBeVisible();

  // Cancel: gone from public schedule; reinstate: back.
  await page.getByRole("button", { name: "Cancel trip" }).click();
  await expect(page.getByText("Cancelled", { exact: true })).toBeVisible();
  await page.goto("/trips");
  await expect(page.locator("li").filter({ hasText: renamed })).toHaveCount(0);

  await page.goBack();
  await page.getByRole("button", { name: "Reinstate trip" }).click();
  await expect(page.getByRole("status")).toContainText("Back on");
  await page.goto("/trips");
  await expect(page.locator("li").filter({ hasText: renamed })).toBeVisible();
});
