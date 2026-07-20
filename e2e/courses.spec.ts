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

test("staff can configure and hide a catalog course", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/courses");
  const course = page.getByRole("listitem").filter({ hasText: "Discover Scuba Diving" });
  await course.getByText("Edit", { exact: true }).click();
  await course.getByLabel("Course price ($)").fill("149.00");
  await course.getByLabel("With eLearning ($)").fill("249.00");
  await course.getByRole("button", { name: "Save course" }).click();
  await expect(page.getByText("Course settings saved")).toBeVisible();
  await expect(page.getByText("Course $149.00").first()).toBeVisible();
  await page
    .getByRole("listitem")
    .filter({ hasText: "Discover Scuba Diving" })
    .getByRole("button", { name: "Hide" })
    .click();
  await expect(page.getByText("Course hidden")).toBeVisible();
});
