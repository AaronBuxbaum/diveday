import { expect, type Page, test } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";

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
  await page.goto("/trips");
  await page.getByRole("link", { name: /Discover Scuba — Pool & Reef/ }).click();
  await expect(page.getByText("Course session · Discover Scuba Diving")).toBeVisible();

  await page.getByLabel("Name").fill("Nora Quinn");
  await page.getByLabel("Email").fill("nora@example.com");
  await page.getByRole("button", { name: "Book my spot" }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Nora/ })).toBeVisible();

  await page.getByLabel("BCD size").selectOption("L");
  await page.getByLabel("Wetsuit size").selectOption("XL");
  await page.getByRole("button", { name: "Save gear request" }).click();
  await expect(page.getByRole("status")).toContainText("gear request is with the crew");
});

test("staff can create a course and see the live operations report", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto("/shop/courses");
  await page.getByLabel("Course name").fill(`Night Diver — ${Date.now()}`);
  await page.getByRole("button", { name: "Add course" }).click();
  await expect(page.getByRole("status")).toContainText("Course added");

  await page.goto("/shop/reports");
  await expect(page.getByRole("heading", { name: "Operations at a glance" })).toBeVisible();
  await expect(page.getByText("Discover Scuba — Pool & Reef")).toBeVisible();
});
