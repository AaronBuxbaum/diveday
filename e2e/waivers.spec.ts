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

test("one waiver button sends a resumable link and a medical yes surfaces follow-up", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/schedule");
  await page
    .locator("li")
    .filter({ hasText: "Two-Tank Reef — Molasses & French" })
    .getByRole("link")
    .click();
  await page.waitForURL(/\/shop\/blue-mantis\/trips\//);
  const staffTripUrl = page.url();

  const diverSection = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: /^Divers/ }) });
  // The whole waiver is a single button; for an unsent diver it reads "Send waiver".
  await diverSection.getByRole("button", { name: "Send waiver" }).first().click();
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
  // success state; it becomes an explicit staff follow-up item.
  await page.getByRole("radio", { name: "Yes" }).first().check();
  await page.getByRole("button", { name: "Sign waiver" }).click();
  await expect(page.getByRole("heading", { name: "Waiver received" })).toBeVisible();
  await expect(page.getByText(/will privately review one of your answers/)).toBeVisible();

  // Back on the roster, the single button now reports the completed-but-flagged
  // state, and the medical answer is spelled out for staff follow-up.
  await page.goto(staffTripUrl);
  await expect(diverSection.getByText("Medical review", { exact: true })).toBeVisible();
  await expect(diverSection.getByText("Follow up before boarding")).toBeVisible();
});

test("staff edit the single shop waiver and each edit is kept as a version", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/waivers");

  const release = page
    .locator("section")
    .filter({ has: page.getByRole("heading", { name: "Release text" }) });

  // The current version is shown, and the release text is directly editable.
  await expect(release.getByText("Version 1")).toBeVisible();

  // Editing pre-fills the current text and saves a new version rather than
  // mutating the one divers may already have signed. Title is immutable.
  const releaseTextarea = page.getByLabel("Release text");
  await expect(releaseTextarea).toHaveValue(/scuba diving/);
  await releaseTextarea.fill(
    "Revised release: I accept the inherent risks of boat charters and open-water diving for this trip.",
  );
  await page.getByRole("button", { name: "Save new version" }).click();
  await expect(page.getByRole("status")).toContainText("new version");

  // The current card advances to v2.
  await expect(release.getByText("Version 2")).toBeVisible();
});
