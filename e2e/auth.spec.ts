import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, READ_ONLY, test } from "./fixtures";
import { signOut } from "./helpers";

/**
 * READ_ONLY holds here: a session is a JWT in a cookie (`session: { strategy: "jwt" }`,
 * src/lib/auth.config.ts) — signing in, failing to sign in, and signing out all write
 * no row, and the fleet disables the rate limiter that would otherwise keep counters.
 */

test("unauthenticated /shop redirects to sign-in", { tag: READ_ONLY }, async ({ page }) => {
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
  await expect(page.getByRole("heading", { name: "Welcome back" })).toBeVisible();
});

test("wrong password shows a friendly error and stays signed out", { tag: READ_ONLY }, async ({
  page,
}) => {
  await page.goto("/sign-in");
  // Sign-in is for staff; the demo playground entry stays on the homepage only.
  await expect(page.getByRole("button", { name: "Explore the demo shop" })).toHaveCount(0);
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill("wrong-password");
  await page.getByRole("button", { name: "Sign in" }).click();
  // Filtered because Next's route announcer is also role="alert".
  await expect(page.getByRole("alert").filter({ hasText: "don't match" })).toBeVisible();
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("staff sign-in lands on the shop dashboard and sign-out locks it again", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  await expect(page).toHaveURL(/\/shop/);
  await expect(
    page.getByRole("heading", { name: /Good (morning|afternoon|evening|night), Dana/ }),
  ).toBeVisible();
  // Today leads with the boat that sails today, not a generic trip list.
  await expect(page.getByRole("heading", { name: "Sailing today" })).toBeVisible();
  // The departure card's own count line — one seat count, not two. The header
  // used to repeat the start time and a "9 of 12 booked" row underneath it.
  await expect(page.getByText(/\d+ clear to board/)).toBeVisible();

  await signOut(page);
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});
