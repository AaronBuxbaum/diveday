import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { signInAs } from "./helpers";

// The role lens (20260721-role-aware-landing): the same Today, led by the
// signed-in person's work. Each test signs in fresh — the lens is the point.

test("a captain's Today leads with the boat they crew", async ({ page }) => {
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  // The seed assigns the captain to today's charter, so their boat is badged
  // and the greeting names it.
  await expect(page.getByText("You’re crewing", { exact: false }).first()).toBeVisible();
  await expect(page.getByRole("link", { name: "Boarding" }).first()).toBeVisible();
});

test("an instructor's Today leads with their sessions and student readiness", async ({ page }) => {
  await signInAs(page, DEV_STAFF_LOGINS.instructor);
  await expect(page.getByRole("heading", { name: "Your sessions" })).toBeVisible();
  const firstSession = page
    .locator("section", { has: page.getByRole("heading", { name: "Your sessions" }) })
    .getByRole("link", { name: "Open roster" })
    .first();
  await expect(firstSession).toBeVisible();
});

test("an owner keeps the whole-shop Today, no lens", async ({ page }) => {
  await signInAs(page, DEV_STAFF_LOGINS.owner);
  await expect(page.getByRole("heading", { level: 1 })).toContainText("Good to see you");
  await expect(page.getByRole("heading", { name: "Your sessions" })).toHaveCount(0);
  await expect(page.getByText("You’re crewing")).toHaveCount(0);
});
