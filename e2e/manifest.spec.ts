import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

async function signInAsOwner(page: Page) {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/shop/);
}

test("live manifest retains blocked divers and records an explicit not-boarded result", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Boat manifest" }).click();

  await expect(page.getByRole("heading", { name: "Boat manifest" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Readiness needs attention" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  await page.locator("#roll-call-list").scrollIntoViewIfNeeded();
  const checkpointScroll = await page.evaluate(() => window.scrollY);
  await page
    .getByRole("link", { name: "After dive 1" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=after_dive_1/);
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - checkpointScroll))
    .toBeLessThan(100);
  await page
    .getByRole("link", { name: "Before departure" })
    .evaluate((link: HTMLElement) => link.click());
  await expect(page).toHaveURL(/checkpoint=departure/);

  await page.getByText("Add a note to this roll-call record").first().click();
  await page.getByLabel("Optional note").first().fill("Guest asked to sit out before departure.");
  const rollCallScroll = await page.evaluate(() => window.scrollY);
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByText("Not-boarded status recorded.", { exact: true })).toBeVisible();
  await expect
    .poll(async () => Math.abs((await page.evaluate(() => window.scrollY)) - rollCallScroll))
    .toBeLessThan(100);
  await expect(page).not.toHaveURL(/#roll-call-/);
  await expect(page.getByRole("button", { name: "Not boarded ✓" }).first()).toBeVisible();
  await expect(page.getByText("Not boarded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("button", { name: "Not boarded ✓" })).toHaveCount(2);
});

test("captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call", async ({
  page,
  context,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.getByRole("link", { name: "Boat manifest" }).click();

  await page.getByRole("button", { name: "Save for offline" }).click();
  await expect(page.getByText(/Saved\. Open offline roll call/)).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  // Offline reload serves the device copy; its freshness badge reads
  // "current device snapshot".
  await expect(page.getByText("current device snapshot")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  // Two live regions exist here (the action message and the connectivity
  // badge); scope to the one carrying the sync message.
  await expect(page.getByRole("status").filter({ hasText: "waiting to sync" })).toBeVisible();

  await context.setOffline(false);
  await expect(page.getByRole("status").filter({ hasText: "reconciled" })).toBeVisible();
});
