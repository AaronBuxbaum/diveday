import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { daysFromNow } from "./helpers";

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

test("staff import a course page, edit it, publish it, and a signed-out diver books from it", async ({
  page,
}) => {
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/courses/catalog");
  // Rescue is in the catalog but not yet a page this shop has written.
  const card = page.getByRole("listitem").filter({ hasText: "Rescue Diver" });
  await card.getByRole("button", { name: "Import and edit" }).click();
  await expect(page).toHaveURL(/\/courses\/rescue-diver\/edit/);

  const dayPlan = page.getByLabel("Day plan");
  await dayPlan.fill(`${await dayPlan.inputValue()}\n\nDay 4 — 9:00am–noon\nScenario retest`);
  await page.getByLabel("FAQ").fill("Do I need my own gear?\nNo — we provide everything.");
  await page.getByRole("button", { name: "Save course page" }).click();
  await expect(page.getByRole("status")).toContainText("Course page saved");

  await page.getByRole("button", { name: "Take page down" }).click();
  await expect(page.getByRole("status")).toContainText("taken down");
  await page.getByRole("button", { name: "Publish page" }).click();
  await expect(page.getByRole("status")).toContainText("live");

  // A diver arrives with no session at all.
  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/courses/rescue-diver");
  await expect(page.getByRole("heading", { name: "Rescue Diver", level: 1 })).toBeVisible();
  // The cert gate appears twice on purpose: once as a spec chip, and again in
  // the admission block that owns the shop's own prerequisite prose, so the
  // two can never be read as one continuous claim.
  await expect(
    page.getByLabel("At a glance").getByText("Advanced Open Water or higher"),
  ).toBeVisible();
  const admission = page.getByRole("region", { name: "Who can enrol" });
  await expect(admission.getByText("Advanced Open Water or higher")).toBeVisible();
  await expect(admission.getByRole("heading", { name: "From the shop" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Day 4" })).toBeVisible();
  await expect(page.getByText("Do I need my own gear?")).toBeVisible();

  // The staff pages above and below it stay closed to that same visitor.
  await page.goto("/shop/blue-mantis/courses/rescue-diver/edit");
  await expect(page).toHaveURL(/\/sign-in/);
  await page.goto("/shop/blue-mantis/courses");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("a diver books a course session from its public page", async ({ page }) => {
  // Schedule this run's own session rather than spending a seeded seat: the e2e
  // database persists across runs, so a test that books the demo session works
  // exactly six times and then fails as "full".
  const sessionTitle = `Open Water Diver — session ${Date.now()}`;
  await signInAsOwner(page);
  await page.goto("/shop/blue-mantis/trips/new");
  await page.getByLabel("Course").selectOption({ label: "Open Water Diver" });
  await page.getByLabel("Title").fill(sessionTitle);
  await page.getByLabel("Date").fill(daysFromNow(21));
  await page.getByLabel("Departs").fill("08:00");
  await page.getByLabel("Returns").fill("17:00");
  await page.getByRole("button", { name: "Put it on the board" }).click();
  await expect(page.getByRole("status")).toBeVisible(); // created banner ⇒ the redirect settled

  // A course session refuses bookings until an instructor is on its crew — the
  // rule that makes this flow safe, and the reason the seeded session works.
  await page.goto("/shop/blue-mantis/schedule");
  await page.getByRole("link", { name: new RegExp(sessionTitle) }).click();
  await expect(
    page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
  ).toBeVisible();
  await page.getByLabel(/Marcus Webb/).check();
  await page.getByRole("button", { name: "Save crew" }).click();
  await expect(
    page.getByText("cannot take bookings until one assigned crew member has the instructor role"),
  ).toBeHidden();

  await page.context().clearCookies();
  await page.goto("/shop/blue-mantis/courses/open-water-diver");
  await expect(page.getByRole("heading", { name: "Upcoming dates" })).toBeVisible();
  // Sessions are listed soonest first, so the one just scheduled 21 days out is
  // the last — and the only one this test may consume a seat from.
  await page.getByRole("link", { name: "Book this date" }).last().click();
  await expect(page.getByText("Course session · Open Water Diver")).toBeVisible();

  const diver = `Ravi ${Date.now()}`;
  await page.getByLabel("Name").fill(diver);
  await page.getByLabel("Email").fill(`ravi-${Date.now()}@example.com`);
  await page.getByRole("button", { name: /^Book (these spots|the last spot)$/ }).click();
  await expect(page.getByRole("heading", { name: /You're on the boat, Ravi/ })).toBeVisible();
});
