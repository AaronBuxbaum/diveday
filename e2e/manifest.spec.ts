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

  await page.getByRole("button", { name: "Mark not boarded" }).first().click();
  await expect(page.getByRole("status")).toContainText("Not-boarded status recorded");
  await expect(page.getByText("Not boarded", { exact: true }).first()).toBeVisible();
});
