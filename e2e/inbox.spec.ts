import { expect, signedInAsOwner, test } from "./fixtures";

/**
 * DiveDay's own inbox (docs ADR 20260724-resend-webhook-email-events): mail
 * sent to the platform's role addresses, not to a shop. The seed files three
 * routed messages plus one to an address no mailbox claims; the demo owner is
 * the configured operator (see playwright.config.ts), so they see all of it.
 */
test.describe("as the operator", () => {
  signedInAsOwner();

  test("reads received mail and clears it off the waiting list", async ({ page }) => {
    await page.goto("/admin/inbox");
    await expect(page.getByRole("heading", { level: 1, name: "Inbox" })).toBeVisible();

    const message = page.getByRole("listitem").filter({ hasText: "Priya Raman" });
    await expect(message).toContainText("how much of that comes across?");
    await expect(message).toContainText("to hello@dive.day");

    await message.getByRole("button", { name: "Mark handled" }).click();
    await expect(page.getByText("how much of that comes across?")).toBeHidden();

    // Handled mail isn't deleted — it's one toggle away.
    await page.getByRole("link", { name: "Show handled too" }).click();
    await expect(page.getByText("how much of that comes across?")).toBeVisible();
    await page
      .getByRole("listitem")
      .filter({ hasText: "Priya Raman" })
      .getByRole("button", { name: "Reopen" })
      .click();
    await expect(page.getByText("how much of that comes across?")).toBeVisible();
  });

  test("sees mail to an address nobody claims, flagged as unclaimed", async ({ page }) => {
    await page.goto("/admin/inbox");
    const unrouted = page.getByRole("listitem").filter({ hasText: "hllo@dive.day" });
    await expect(unrouted).toContainText("no mailbox claims this address");
  });

  test("adds an address, gives someone access, and retires it", async ({ page }) => {
    await page.goto("/admin/mailboxes");
    await expect(page.getByRole("heading", { level: 1, name: "Addresses" })).toBeVisible();

    await page.getByLabel("Address").fill("press@dive.day");
    await page.getByLabel("What it’s for").fill("Press");
    await page.getByRole("button", { name: "Add address" }).click();
    await expect(page.getByText("Address added")).toBeVisible();

    const mailbox = () => page.getByRole("listitem").filter({ hasText: "press@dive.day" });
    await mailbox().getByLabel("Add a reader by email").fill("marcus@bluemantis.example");
    await mailbox().getByRole("button", { name: "Add reader" }).click();
    await expect(page.getByText("can read this mailbox now")).toBeVisible();
    await expect(mailbox()).toContainText("marcus@bluemantis.example");

    // An address with no DiveDay login behind it is refused, not guessed at.
    await mailbox().getByLabel("Add a reader by email").fill("nobody@nowhere.example");
    await mailbox().getByRole("button", { name: "Add reader" }).click();
    await expect(page.getByText("No active DiveDay login")).toBeVisible();

    await mailbox().getByRole("button", { name: "Retire" }).click();
    await expect(page.getByText("Address retired")).toBeVisible();
    await expect(page.getByText("press@dive.day")).toBeHidden();
  });
});

test.describe("as everyone else", () => {
  test("a staff member who isn't an operator can't find the console", async ({ page }) => {
    // The instructor login is staff but neither an operator nor a mailbox
    // member. /admin must read as "there is nothing here", not "you are not
    // allowed" — a dive-shop employee has no business learning it exists.
    await page.goto("/sign-in");
    await page.getByLabel("Email").fill("marcus@bluemantis.example");
    await page.getByLabel("Password").fill("dev-instructor-password");
    await page.getByRole("button", { name: "Sign in" }).click();
    await page.waitForURL(/\/shop/);

    const response = await page.goto("/admin/inbox");
    expect(response?.status()).toBe(404);
  });

  test("a signed-out visitor is sent to sign in, never to the console", async ({ page }) => {
    await page.goto("/admin/inbox");
    await expect(page).toHaveURL(/\/sign-in/);
  });
});
