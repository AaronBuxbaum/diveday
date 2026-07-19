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

test("staff issues a resumable waiver and a medical yes stays visible for review", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.getByRole("link", { name: /Two-Tank Reef — Molasses & French/ }).click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  const staffTripUrl = page.url();

  const waiverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Waivers" }) });
  await waiverSection.getByRole("button", { name: "Email link" }).first().click();
  await expect(page.getByRole("heading", { name: "Private waiver link ready" })).toBeVisible();
  const waiverHref = await page
    .getByRole("link", { name: "Open waiver link" })
    .getAttribute("href");
  expect(waiverHref).toMatch(/^\/waivers\//);

  await page.goto(waiverHref ?? "/");
  await expect(page.getByRole("heading", { name: "A quick step before the dock" })).toBeVisible();
  await page.getByLabel("Type your full name").fill("Priya Sharma");
  await page.getByLabel("I have read this waiver, understand it, and agree to it.").check();
  await page.getByRole("button", { name: "Save and finish later" }).click();
  await expect(page.getByRole("status")).toContainText("progress is saved");
  await expect(page.getByLabel("Type your full name")).toHaveValue("Priya Sharma");

  // The first question's affirmative answer must not disappear into a generic
  // success state; it becomes an explicit staff review blocker.
  await page.getByRole("radio", { name: "Yes" }).first().check();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByRole("heading", { name: "Waiver received" })).toBeVisible();
  await expect(page.getByText(/will privately review one of your answers/)).toBeVisible();

  await page.goto(staffTripUrl);
  await expect(waiverSection.getByText("Medical review", { exact: true })).toBeVisible();
  await waiverSection.getByText(/Activity ·/).click();
  await expect(waiverSection.getByText("Medical review required")).toBeVisible();
});
