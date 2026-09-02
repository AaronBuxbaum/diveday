import { expect, test } from "./fixtures";

/**
 * **Proving the front desk before diver replies are routed to it** (issue
 * #1288).
 *
 * The address a manager types into Settings became the `Reply-To` on every
 * email DiveDay sends a diver (ADR 20260902-sender-standards-for-ses). Nothing
 * proved the shop controlled it, so a typo — or a manager who fills in somebody
 * else's address — would steer replies carrying medical and contact details to
 * a third party. `shops.contact_email_confirmed_at` gates the header, and this
 * is the flow that sets it.
 *
 * **A shop of its own** (`privateShop`, ADR 20260815-per-test-private-shops):
 * every test here writes shop-wide settings, and `/api/test/reset` restores the
 * shared fixture's schedule but not its configuration. No `signedInAsOwner()` —
 * the fixture signs the page in as the minted shop's own owner, and a
 * blue-mantis session in the same context would race it for the cookie.
 *
 * The confirmation *link* is not asserted end to end: no email provider is
 * configured in the e2e fleet, so nothing leaves the building and there is no
 * inbox to read a token out of. What the browser can prove is the state the
 * shop sees, and that the token page refuses a link it has no reason to trust —
 * `src/db/shop-contact-email.test.ts` carries the claim-and-stamp half.
 */
test.describe("the shop's reply address", () => {
  test("reads as unconfirmed the moment it is saved", async ({ page, privateShop }) => {
    // The mint and the live sign-in the fixture pays for are inside this test's
    // own budget; same aggregate-cost reasoning as every other multi-leg spec.
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/settings#contact`);

    await page.getByLabel("Contact email").fill("front-desk@example.invalid");
    await page.getByRole("button", { name: "Save contact details" }).click();
    // By its words, not by role: the settings page carries a second `role="status"`
    // (the "online payments aren't switched on" notice) in this environment.
    await expect(page.getByText("Contact details saved.")).toBeVisible();

    // The badge is the whole sentence — no caption explaining what unconfirmed
    // costs, the way the Stripe row says "Not connected" and stops.
    await expect(page.getByText("Unconfirmed")).toBeVisible();
    await expect(page.getByText("front-desk@example.invalid")).toBeVisible();
  });

  test("keeps saying unconfirmed after the address changes again", async ({
    page,
    privateShop,
  }) => {
    test.setTimeout(60_000);
    await page.goto(`/shop/${privateShop.slug}/settings#contact`);
    await page.getByLabel("Contact email").fill("first@example.invalid");
    await page.getByRole("button", { name: "Save contact details" }).click();
    // By its words, not by role: the settings page carries a second `role="status"`
    // (the "online payments aren't switched on" notice) in this environment.
    await expect(page.getByText("Contact details saved.")).toBeVisible();

    await page.getByLabel("Contact email").fill("second@example.invalid");
    await page.getByRole("button", { name: "Save contact details" }).click();
    // By its words, not by role: the settings page carries a second `role="status"`
    // (the "online payments aren't switched on" notice) in this environment.
    await expect(page.getByText("Contact details saved.")).toBeVisible();

    await expect(page.getByText("second@example.invalid")).toBeVisible();
    await expect(page.getByText("Unconfirmed")).toBeVisible();
  });

  test("a link nobody was sent confirms nothing, and names no shop", async ({ page }) => {
    await page.goto("/confirm-contact/not-a-real-token");
    await expect(page.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
    // No confirm button on a dead link, and no way to learn whose it was.
    await expect(page.getByRole("button", { name: "Yes, this is the right address" })).toHaveCount(
      0,
    );
  });

  test("a forged ?confirmed=1 still reads as a dead link", async ({ page }) => {
    // The success state is derived from a token this request actually consumed,
    // never from a caller-controlled query parameter.
    await page.goto("/confirm-contact/not-a-real-token?confirmed=1");
    await expect(page.getByRole("heading", { name: "This link is no longer valid" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Confirmed" })).toHaveCount(0);
  });
});
