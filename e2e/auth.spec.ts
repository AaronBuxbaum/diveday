import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, READ_ONLY, test } from "./fixtures";
import { STAFF_DAY_HEADING, signOut } from "./helpers";

/**
 * A session is a database row under Better Auth (`account_sessions`, the `session` model in
 * `src/lib/auth.ts`): a live sign-in through the form inserts one and signing out deletes it.
 * So READ_ONLY holds only where no sign-in succeeds. The redirect reads nothing, and a refused
 * password reads the account and writes nothing, since the fleet disables the rate limiter
 * that would otherwise keep counters. The sign-in-and-out test writes, and carries no tag.
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
  await expect(page.getByRole("alert").filter({ hasText: "don’t match" })).toBeVisible();
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});

test("staff sign-in lands on the shop dashboard and sign-out locks it again", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();

  // Straight to the staffer's own shop, not through the bare /shop.
  await expect(page).toHaveURL(/\/shop\/blue-mantis$/);
  await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
  // Today leads with the boats that sail today, not a generic trip list: the
  // summary sentence counts them, and each departure says how many are ready.
  await expect(page.getByText(/boats? today[.,]/)).toBeVisible();
  await expect(page.getByText(/^\d+ of \d+ ready$/).first()).toBeVisible();

  await signOut(page);
  await page.goto("/shop");
  await expect(page).toHaveURL(/\/sign-in/);
});

/**
 * The installed app opens on `/shop` (`start_url`, src/app/manifest.ts). With
 * the cookie cache cold, which it is after five idle minutes, the edge proxy
 * cannot say which shop to open and lets the request through. The server's
 * `/shop` handler then decides from the session itself (issue #2342). Dropping
 * the cache cookie is that cold start: the session cookie stays.
 */
test("/shop opens a signed-in staffer's shop even when the edge cannot decide", {
  tag: READ_ONLY,
}, async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByLabel("Password").fill(DEV_STAFF_LOGINS.owner.password);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();

  await page.context().clearCookies({ name: "better-auth.session_data" });
  const sessionCookies = (await page.context().cookies()).map((cookie) => cookie.name);
  expect(sessionCookies).toContain("better-auth.session_token");
  expect(sessionCookies).not.toContain("better-auth.session_data");

  const response = await page.request.get("/shop", { maxRedirects: 0 });
  expect(response.status()).toBe(307);
  expect(response.headers().location).toMatch(/^\/shop\/[^/]+$/);

  await page.goto("/shop");
  await expect(page).toHaveURL(/\/shop\/[^/]+$/);
  await expect(page.getByRole("heading", { level: 1, name: STAFF_DAY_HEADING })).toBeVisible();
});
