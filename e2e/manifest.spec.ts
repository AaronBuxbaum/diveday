import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

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
  await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
  await page.getByRole("link", { name: "Open boat manifest" }).click();

  await expect(page.getByRole("heading", { name: "Boat manifest" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Roll call" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Readiness needs attention" })).toBeVisible();
  await expect(page.getByText("Priya Sharma")).toBeVisible();

  await page.getByText("Add a note to this roll-call record").first().click();
  await page.getByLabel("Optional note").first().fill("Guest asked to sit out before departure.");
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("status")).toContainText("Not-boarded status recorded");
  await expect(page).toHaveURL(/#roll-call-/);
  await expect(page.getByRole("button", { name: "Not boarded ✓" }).first()).toBeVisible();
  await expect(page.getByText("Not boarded", { exact: true }).first()).toBeVisible();
  await expect(page.getByText("Guest asked to sit out before departure.")).toBeVisible();
});

test("captain saves the full checkpoint manifest, reloads it offline, and reconciles roll call", async ({
  page,
  context,
}) => {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
  await page.getByRole("link", { name: "Open boat manifest" }).click();

  await page.getByRole("button", { name: "Save for offline" }).click();
  await expect(page.getByText(/Saved\. Open offline roll call/)).toBeVisible();
  await page.getByRole("link", { name: "Open offline roll call" }).click();
  await expect(page.getByText("Offline manifest", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "After dive 1" })).toBeVisible();

  await context.setOffline(true);
  await page.reload();
  await expect(page.getByText("Device copy · current")).toBeVisible();
  await page.getByRole("button", { name: "After dive 1" }).click();
  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("status")).toContainText("waiting to sync");

  await context.setOffline(false);
  await expect(page.getByRole("status")).toContainText("reconciled");
});
