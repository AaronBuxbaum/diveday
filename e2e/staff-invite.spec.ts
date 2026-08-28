import { DEMO_SHOP_SLUG, DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { expect, signedInAs, test } from "./fixtures";
import { signInAsOwner, signOut } from "./helpers";

// Real invite links only ever exist inside a real email — there is no
// staff-facing screen that displays them (same reasoning as
// e2e/account-lifecycle.spec.ts's verify/reset links). /api/test/seed-account-token
// mints a real one for an account the real invite action already created, so
// these specs still drive the actual pages and server actions rather than
// stopping at the token-storage layer.

const SHOP = DEMO_SHOP_SLUG;

test.describe("as owner", () => {
  signedInAs("owner");

  test("an owner invites a new instructor, who accepts the invite and lands signed into the shop", async ({
    page,
    request,
  }) => {
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
    const row = page.locator("li").filter({ hasText: "Priya Nair" }).filter({ visible: true });
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

  test("removing a staff member lands immediately with an Undo banner, no confirm dialog", async ({
    page,
    request,
  }) => {
    // Invites a new member, signs in as them, then removes and undoes it —
    // several full navigations and status-toast waits chained in one test.
    // Same aggregate-cost reasoning as visual.spec.ts's `test.setTimeout`: a
    // traced CI failure measured the total sequential cost at 17.7s against
    // the default 15s test timeout, every individual step resolving
    // successfully. The `signedInAs("owner")` above only removes the
    // *first* sign-in's cost — this test signs out and back in as the owner
    // mid-flow (to act on the new hire's account), which is inherently a
    // live re-authentication the cached storageState fixture can't cover.
    test.setTimeout(30_000);
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
    const row = page.locator("li").filter({ hasText: "Talia Reyes" }).filter({ visible: true });
    await row.getByRole("button", { name: "Disable" }).click();
    await expect(row.getByText("Disabled")).toBeVisible();

    // Land-then-undo (principle 7, docs/design/principles.md): no confirm()
    // dialog — deletion takes effect immediately and an Undo banner offers
    // a one-tap reversal.
    await row.getByRole("button", { name: /^Delete/ }).click();
    await expect(
      page.locator("li").filter({ hasText: "Talia Reyes" }).filter({ visible: true }),
    ).toHaveCount(0);
    await expect(page.getByText("Deleted Talia Reyes.")).toBeVisible();

    await page.getByRole("button", { name: "Undo" }).click();
    const restoredRow = page
      .locator("li")
      .filter({ hasText: "Talia Reyes" })
      .filter({ visible: true });
    await expect(restoredRow.getByText("Active")).toBeVisible();
    // The row reads its roles as words now that they are a per-row disclosure
    // (ADR 20260827-the-shops-shelves, slice 9h).
    await expect(
      restoredRow.getByRole("button", { name: "Edit roles for Talia Reyes" }),
    ).toContainText("Instructor");
  });

  /**
   * Slice 9h end to end: a row's disclosure closes to save, Undo takes it
   * back in one tap, Escape abandons an edit, and a refusal reopens the row
   * with its words *on that row* rather than in a banner above eleven people
   * (ADR 20260827-the-shops-shelves). Driven on a freshly invited teammate so
   * no seeded staffer's roles leak into the next spec sharing this worker.
   */
  test("a row's roles save when the row closes, undo in one tap, and refuse on the row", async ({
    page,
  }) => {
    await page.goto(`/shop/${SHOP}/settings/team`);

    const email = `row-roles-${Date.now()}@example.com`;
    const inviteSection = page.locator("section").filter({ hasText: "Invite someone" });
    await inviteSection.getByLabel("Full name").fill("Rosa Delgado");
    await inviteSection.getByLabel("Email").fill(email);
    await inviteSection.getByLabel("Instructor").check();
    await inviteSection.getByRole("button", { name: "Send invite" }).click();
    await expect(page.getByText("Invite sent.")).toBeVisible();

    const row = page.locator("li").filter({ hasText: "Rosa Delgado" }).filter({ visible: true });
    const roles = row.getByRole("button", { name: "Edit roles for Rosa Delgado" });
    await expect(roles).toContainText("Instructor");

    // Close is the save — there is no Save button on the row at all.
    await roles.click();
    await row.getByLabel("Divemaster").check();
    await roles.click();
    await expect(roles).toContainText("Divemaster");
    await expect(row.getByText("Team changes saved.")).toBeVisible();

    // Undo is one re-save, and offers nothing to undo back.
    await row.getByRole("button", { name: "Undo the role change for Rosa Delgado" }).click();
    await expect(roles).not.toContainText("Divemaster");
    await expect(
      row.getByRole("button", { name: "Undo the role change for Rosa Delgado" }),
    ).toHaveCount(0);

    // Escape abandons the edit: the row closes and nothing is written.
    await roles.click();
    await row.getByLabel("Captain").check();
    await page.keyboard.press("Escape");
    await expect(roles).toHaveAttribute("aria-expanded", "false");
    await expect(roles).not.toContainText("Captain");

    // A refusal reopens the row and says so beside the checkboxes. Exactly one
    // rendering, and it is inside this person's row — never a page banner.
    await roles.click();
    await row.getByLabel("Instructor").uncheck();
    await roles.click();
    await expect(row.getByText("Check at least one role before saving.")).toBeVisible();
    await expect(page.getByText("Check at least one role before saving.")).toHaveCount(1);
    await expect(roles).toHaveAttribute("aria-expanded", "true");
    await expect(roles).toContainText("Instructor");
  });

  test("the last-owner guard refuses removing the shop's sole owner", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/settings/team`);

    const ownerRow = page.locator("li").filter({ hasText: DEV_STAFF_LOGINS.owner.email });
    // Delete is intentionally only offered after an account is disabled. A sole
    // owner cannot be disabled, so exercise the same last-owner guard through
    // their own roles disclosure: unticking Owner and closing the row is the
    // save (ADR 20260827-the-shops-shelves, slice 9h).
    await expect(ownerRow.getByRole("button", { name: /^Delete/ })).toHaveCount(0);
    const ownerRoles = ownerRow.getByRole("button", { name: /^Edit roles for / });
    await ownerRoles.click();
    await ownerRow.getByLabel("Owner").uncheck();
    await ownerRoles.click();

    // On the row that produced it, once — the page banner never carries it.
    await expect(ownerRow.getByText("the shop needs at least one owner")).toBeVisible();
    await expect(page.getByText("the shop needs at least one owner")).toHaveCount(1);
    await expect(ownerRoles).toHaveAttribute("aria-expanded", "true");
    await expect(
      page
        .locator("li")
        .filter({ hasText: DEV_STAFF_LOGINS.owner.email })
        .filter({ visible: true })
        .getByText("Active"),
    ).toBeVisible();
  });
});

test("a tampered invite token reveals nothing", async ({ page }) => {
  await page.goto("/invite/not-a-real-token");
  await expect(page.getByRole("heading", { name: "This invite isn’t available" })).toBeVisible();
});

test.describe("as captain", () => {
  signedInAs("captain");

  test("a captain (not owner/manager) is redirected away from team settings", async ({ page }) => {
    await page.goto(`/shop/${SHOP}/settings/team`);
    // The refusal says why instead of teleporting silently — the same
    // explained-landing rule every gate refusal follows. It lands on Today
    // rather than Settings: Settings takes the same owner/manager gate now, so
    // landing there would bounce this captain a second time and lose the
    // reason. FlashParams strips the query, so assert the banner text rather
    // than the URL param.
    await expect(page).toHaveURL(new RegExp(`/shop/${SHOP}(\\?.*)?$`));
    await expect(
      page.getByText("Team management is limited to owners and managers."),
    ).toBeVisible();
  });
});
