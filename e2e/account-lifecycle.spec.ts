import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

// Real happy-path verify/reset links only ever exist inside a real email —
// there is no staff-facing screen that displays them (unlike a waiver or
// readiness link), and the token is a hashed DB row rather than something
// this spec can compute the way recap's stateless signed token can
// (e2e/recap.spec.ts). What's covered here: the enumeration-safe
// forgot-password response, and every bearer-token page failing closed on a
// token it doesn't recognize — mirroring e2e/readiness.spec.ts and
// e2e/recap.spec.ts's own "tampered token reveals nothing" coverage.

test("forgot-password gives the same generic response whether or not the email is registered", async ({
  page,
}) => {
  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page).toHaveURL(/\/forgot-password\?sent=1/);
  await expect(page.getByText("If that email has a DiveDay account")).toBeVisible();

  await page.goto("/forgot-password");
  await page.getByLabel("Email").fill("nobody-registered-e2e@example.com");
  await page.getByRole("button", { name: "Send reset link" }).click();
  await expect(page).toHaveURL(/\/forgot-password\?sent=1/);
  await expect(page.getByText("If that email has a DiveDay account")).toBeVisible();
});

test("a tampered email-verification token reveals nothing", async ({ page }) => {
  await page.goto("/verify/not-a-real-token");
  await expect(
    page.getByRole("heading", { name: "This confirmation link isn't valid" }),
  ).toBeVisible();
});

test("a tampered password-reset token reveals nothing and points back to sign-in", async ({
  page,
}) => {
  await page.goto("/reset-password/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This reset link isn't valid" })).toBeVisible();
  await page.getByRole("link", { name: "Back to sign in" }).click();
  await expect(page).toHaveURL(/\/sign-in/);
});

test("sign-in links to forgot-password", async ({ page }) => {
  await page.goto("/sign-in");
  await page.getByRole("link", { name: "Forgot password?" }).click();
  await expect(page).toHaveURL(/\/forgot-password/);
});
