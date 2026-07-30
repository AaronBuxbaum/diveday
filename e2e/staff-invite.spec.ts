import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAsOwner, test } from "./fixtures";
import { signInAs, signInAsOwner } from "./helpers";
import { capture } from "./visual-capture";

// Real invite links only ever exist inside a real email — there is no
// staff-facing screen that displays them (same reasoning as
// e2e/account-lifecycle.spec.ts's verify/reset links). /api/test/seed-account-token
// mints a real one for an account the real invite action already created, so
// these specs still drive the actual pages and server actions rather than
// stopping at the token-storage layer.

const SHOP = DEMO_SHOP_SLUG;

test("an owner invites a new instructor, who accepts the invite and lands signed into the shop", async ({
  page,
  request,
}) => {
  await signInAsOwner(page);
  await page.goto(`/shop/${SHOP}/settings/team`);

  const email = `new-instructor-${Date.now()}@example.com`;
  const inviteSection = page.locator("section").filter({ hasText: "Invite someone" });
  await inviteSection.getByLabel("Full name").fill("Priya Nair");
  await inviteSection.getByLabel("Email").fill(email);
  await inviteSection.getByLabel("Instructor").check();
  await inviteSection.getByRole("button", { name: "Send invite" }).click();

  // Not a URL assertion: FlashParams strips `?notice=invited` via
  // history.replaceState shortly after mount (same reasoning as
  // e2e/account-lifecycle.spec.ts) — the rendered banner is the stable signal.
  await expect(page.getByText("Invite sent.")).toBeVisible();
  const row = page.locator("li").filter({ hasText: "Priya Nair" });
  await expect(row.getByText("Invited")).toBeVisible();

  const seeded = await request.post("/api/test/seed-account-token", {
    data: { email, purpose: "invite" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();

  await page.goto(`/invite/${token}`);
  await page.getByLabel("Password", { exact: true }).fill("a-brand-new-password-123");
  await page.getByLabel("Confirm password").fill("a-brand-new-password-123");
  await page.getByRole("button", { name: "Set password & sign in" }).click();

  // Consuming the link signs the new instructor straight into their shop.
  await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}`));

  // The link is one-time: revisiting it now reads as invalid.
  await page.goto(`/invite/${token}`);
  await expect(page.getByRole("heading", { name: "This invite isn’t available" })).toBeVisible();
});

test("a tampered invite token reveals nothing", async ({ page }) => {
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This invite isn’t available" })).toBeVisible();
});

test("a captain (not owner/manager) is redirected away from team settings", async ({ page }) => {
  await signInAs(page, DEV_STAFF_LOGINS.captain);
  await page.goto(`/shop/${SHOP}/settings/team`);
  await expect(page).toHaveURL(`/shop/${SHOP}`);
});

test("the last-owner guard refuses removing the shop's sole owner", async ({ page }) => {
  await signInAsOwner(page);
  await page.goto(`/shop/${SHOP}/settings/team`);

  const ownerRow = page.locator("li").filter({ hasText: DEV_STAFF_LOGINS.owner.email });
  // Delete is intentionally only offered after an account is disabled. A sole
  // owner cannot be disabled, so exercise the same last-owner guard via the
  // page-level Save changes button that batches every row's role checkboxes.
  await expect(ownerRow.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
  await ownerRow.getByLabel("Owner").uncheck();
  await page.getByRole("button", { name: "Save changes" }).click();

  await expect(page.getByText("the shop needs at least one owner")).toBeVisible();
  await expect(
    page.locator("li").filter({ hasText: DEV_STAFF_LOGINS.owner.email }).getByText("Active"),
  ).toBeVisible();
});

// Visual regression capture for this file's surface (see e2e-and-visual
// skill / e2e/visual-capture.ts). Moved here from the old e2e/visual.spec.ts
// "site tour".
for (const scheme of ["light", "dark"] as const) {
  test.describe(`${scheme} mode`, { tag: "@visual" }, () => {
    // The reused per-worker session, not this file's own live signInAsOwner()
    // helper (used above for the functional tests, which need a fresh
    // session) — faster, and this capture has no reason to need a live sign-in.
    signedInAsOwner();
    test.use({ colorScheme: scheme, viewport: { width: 1280, height: 800 } });

    test(`the team settings page renders true to the design (${scheme})`, async ({ page }) => {
      // The team surface: inviting staff and the current roster, each card's
      // Enable/Disable/Delete immediate-action buttons and its role
      // checkboxes batched into the page's single "Save changes".
      await page.goto(`/shop/${SHOP}/settings/team`);
      await page.getByRole("heading", { level: 1, name: "Team" }).waitFor();
      await capture(page, "settings-team", scheme);
    });
  });
}
