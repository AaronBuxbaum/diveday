import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, test } from "./fixtures";
import { signInAs, signInAsOwner, signOut } from "./helpers";

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

test("removing a staff member lands immediately with an Undo banner, no confirm dialog", async ({
  page,
  request,
}) => {
  await signInAsOwner(page);
  await page.goto(`/shop/${SHOP}/settings/team`);

  const email = `undo-check-${Date.now()}@example.com`;
  const inviteSection = page.locator("section").filter({ hasText: "Invite someone" });
  await inviteSection.getByLabel("Full name").fill("Talia Reyes");
  await inviteSection.getByLabel("Email").fill(email);
  await inviteSection.getByLabel("Instructor").check();
  await inviteSection.getByRole("button", { name: "Send invite" }).click();
  await expect(page.getByText("Invite sent.")).toBeVisible();

  const seeded = await request.post("/api/test/seed-account-token", {
    data: { email, purpose: "invite" },
  });
  expect(seeded.ok()).toBe(true);
  const { token } = await seeded.json();
  await page.goto(`/invite/${token}`);
  await page.getByLabel("Password", { exact: true }).fill("a-brand-new-password-123");
  await page.getByLabel("Confirm password").fill("a-brand-new-password-123");
  await page.getByRole("button", { name: "Set password & sign in" }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}`));

  // Back as the owner to disable and remove the new hire.
  await signOut(page);
  await signInAsOwner(page);
  await page.goto(`/shop/${SHOP}/settings/team`);
  const row = page.locator("li").filter({ hasText: "Talia Reyes" });
  await row.getByRole("button", { name: "Disable" }).click();
  await expect(row.getByText("Disabled")).toBeVisible();

  // Land-then-undo (principle 7, docs/design/principles.md): no confirm()
  // dialog — the removal takes effect immediately and an Undo banner offers
  // a one-tap reversal.
  await row.getByRole("button", { name: /^Delete/ }).click();
  await expect(page.locator("li").filter({ hasText: "Talia Reyes" })).toHaveCount(0);
  await expect(page.getByText("Removed Talia Reyes from the team.")).toBeVisible();

  await page.getByRole("button", { name: "Undo" }).click();
  const restoredRow = page.locator("li").filter({ hasText: "Talia Reyes" });
  await expect(restoredRow.getByText("Active")).toBeVisible();
  await expect(restoredRow.getByLabel("Instructor")).toBeChecked();
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
