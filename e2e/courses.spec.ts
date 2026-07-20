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

test("an uncertified visitor can enroll in an instructor-staffed Discover Scuba session and save rental preferences", async ({
  page,
}) => {
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: /Discover Scuba — Pool & Reef/ }).click();
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();

  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save gear request" }).click();
  await expect(page.getByRole("status")).toContainText("gear request is with the crew");
});

test("staff can price a catalog course in place and hide it", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/courses");
  const row = page.getByRole("row").filter({ hasText: "Discover Scuba Diving" });
  await row.getByLabel("Discover Scuba Diving instruction fee in dollars").fill("149.00");
  await row.getByLabel("Discover Scuba Diving e-learning fee in dollars").fill("100.00");
  await row.getByRole("button", { name: "Save" }).click();
  await expect(page.getByText("Course pricing saved")).toBeVisible();
  // The two items are billed separately, so the row states what the student pays.
  await expect(
    page.getByRole("row").filter({ hasText: "Discover Scuba Diving" }).getByText("$249.00"),
  ).toBeVisible();

  await page
    .getByRole("row")
    .filter({ hasText: "Discover Scuba Diving" })
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(page.getByText("Course hidden")).toBeVisible();
  await expect(
    page.getByRole("row").filter({ hasText: "Discover Scuba Diving" }).getByText("Hidden"),
  ).toBeVisible();
});
