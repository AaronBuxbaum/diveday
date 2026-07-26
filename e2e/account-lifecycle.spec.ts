import type { Page } from "@playwright/test";
import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";

// Real verify/reset links only ever exist inside a real email — there is no
// staff-facing screen that displays them (unlike a waiver or readiness
// link), and the token is a hashed DB row rather than something this spec
// can compute the way recap's stateless signed token can (e2e/recap.spec.ts).
// /api/test/seed-account-token mints a real one (test-only, gated identically
// to /api/test/reset) so the happy paths below still drive the actual pages
// and server actions rather than stopping at the token-storage layer.

/** A fresh, isolated owner account via real onboarding — unique per call so parallel/repeat runs never collide. */
async function onboardFreshOwner(page: Page, slug: string) {
  const unique = `${slug}-${Date.now()}`;
  const email = `${unique}@example.com`;
  await page.goto("/onboard");
  await page.locator('input[name="shopName"]').fill("Account Lifecycle E2E");
  await page.locator('input[name="shopSlug"]').fill(unique);
  await page.locator('input[name="ownerName"]').fill("Riva Okonkwo");
  await page.locator('input[name="ownerEmail"]').fill(email);
  await page.locator('input[name="ownerPassword"]').fill("trial-pass-123");
  await page.getByRole("button", { name: "Create shop & start trial" }).click();
  await expect(page).toHaveURL(/\/shop\//);
  return email;
}

test("a valid email-verification link confirms the account through the real page and action", async ({
  page,
  request,
}) => {
  const email = await onboardFreshOwner(page, "verify-e2e");
  const seeded = await request.post("/api/test/seed-account-token", {
    data: { email, purpose: "email_verification" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/verify/${token}`);
  await page.getByRole("button", { name: "Confirm my email" }).click();
  // Not a URL assertion: FlashParams (src/components/FlashParams.tsx) strips
  // `?confirmed=1` via history.replaceState almost immediately after mount —
  // a deliberate one-shot flash param — so asserting the query string races
  // that effect. The rendered heading is the stable signal.
  await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();

  // The link is one-time: revisiting it (without the flash param) now reads
  // as invalid rather than re-showing the confirm form.
  await page.goto(`/verify/${token}`);
  await expect(
    page.getByRole("heading", { name: "This confirmation link isn't valid" }),
  ).toBeVisible();
});

test("a valid password-reset link sets a new password and signs the owner in", async ({
  page,
  request,
}) => {
  const email = await onboardFreshOwner(page, "reset-e2e");
  const seeded = await request.post("/api/test/seed-account-token", {
    data: { email, purpose: "password_reset" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/reset-password/${token}`);
  // exact: true — "New password" is otherwise a substring match of "Confirm
  // new password" too, and getByLabel's default match is substring-based.
  await page.getByLabel("New password", { exact: true }).fill("a-brand-new-password-123");
  await page.getByLabel("Confirm new password").fill("a-brand-new-password-123");
  await page.getByRole("button", { name: "Set new password" }).click();

  // Consuming the link signs the owner straight into their shop.
  await expect(page).toHaveURL(/\/shop\//);

  // The link is one-time: revisiting it now reads as invalid.
  await page.goto(`/reset-password/${token}`);
  await expect(page.getByRole("heading", { name: "This reset link isn't valid" })).toBeVisible();
});

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
