import { totpCode } from "../src/lib/totp";
import { expect, test } from "./fixtures";
import { E2E_FROZEN_CLOCK } from "./servers";

/**
 * Two-factor enrolment, the recovery-code reveal, and session revocation.
 *
 * **Each test takes a shop of its own** (`privateShop`, ADR
 * 20260815-per-test-private-shops). Everything here writes account-wide state —
 * a sealed TOTP secret, an `account_security` row, the session table — none of
 * which `/api/test/reset` restores, so running it against blue-mantis would
 * leave the demo owner enrolled in two-factor for every spec that follows in the
 * same worker. No `signedInAsOwner()` for the same reason the backup spec gives:
 * the fixture signs this context in as the minted shop's owner, and a
 * blue-mantis session would race it for the cookie.
 *
 * The route carried a written route-coverage exemption claiming a live
 * authenticated session was the obstacle, which was never true — `e2e/fixtures.ts`
 * mints authenticated staff sessions for the whole suite (issue #1020).
 */
test.describe("account security settings", () => {
  // The mint plus the sign-in are inside the test's own budget.
  test.setTimeout(60_000);

  test("enrols in two-factor, reveals the recovery codes, and revokes a session", async ({
    page,
    privateShop,
  }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/security`);
    await expect(page.getByRole("heading", { level: 1, name: "Account security" })).toBeVisible();
    await expect(page.getByText("Not enabled")).toBeVisible();

    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(page.getByText("Enrollment started. Save the secret before enabling two-factor.")).toBeVisible();

    // The secret is what an authenticator app would be given; the code below is
    // what it would then show. Computing it at the *frozen* instant is what
    // makes this deterministic — the server verifies against `nowMs()`, which
    // DIVEDAY_CLOCK pins fleet-wide, so there is nothing to wait for and no
    // window to race (`pnpm check:e2e-hygiene` refuses both).
    const secret = (await page.locator("code").first().innerText()).trim();
    expect(secret).toMatch(/^[A-Z2-7]{32}$/);
    await page
      .getByRole("textbox", { name: "Authenticator code" })
      .fill(totpCode(secret, Date.parse(E2E_FROZEN_CLOCK)));
    await page.getByRole("button", { name: "Enable", exact: true }).click();

    await expect(page.getByText("Two-factor authentication enabled.")).toBeVisible();
    // The status badge carries a tone glyph beside its word, so the button is
    // the unambiguous read on the state.
    await expect(page.getByRole("button", { name: "Disable two-factor" })).toBeVisible();
    await expect(page.getByText("Not enabled")).toHaveCount(0);

    // The reveal, which is the only moment ten usable codes exist anywhere: the
    // shop is told to save them because DiveDay keeps only their hashes.
    await expect(page.getByText("Recovery codes")).toBeVisible();
    await expect(page.locator("code")).toHaveCount(10);
    await expect(
      page.getByText("These codes disappear after setup or in ten minutes."),
    ).toBeVisible();

    // Enrolment is durable, not a rendering of the form that just submitted.
    await page.reload();
    await expect(page.getByRole("button", { name: "Disable two-factor" })).toBeVisible();

    // Revoking the device you are reading on is the honest end of this flow —
    // a freshly minted shop has exactly one session, and taking it away has to
    // eject you or the control is decorative. Where it lands is not the point
    // and is not asserted: signed out under DIVEDAY_E2E the app shows the demo
    // shell rather than /sign-in.
    await page.getByRole("button", { name: "Revoke", exact: true }).first().click();
    await expect(page.getByRole("heading", { level: 1, name: "Account security" })).toHaveCount(0);
    await page.goto(`/shop/${privateShop.slug}/settings/security`);
    await expect(page.getByRole("heading", { level: 1, name: "Account security" })).toHaveCount(0);
  });

  test("refuses a code that is not the current one", async ({ page, privateShop }) => {
    await page.goto(`/shop/${privateShop.slug}/settings/security`);
    await page.getByRole("button", { name: "Start setup" }).click();
    await expect(page.getByText("Enrollment started. Save the secret before enabling two-factor.")).toBeVisible();

    await page.getByRole("textbox", { name: "Authenticator code" }).fill("000000");
    await page.getByRole("button", { name: "Enable", exact: true }).click();

    await expect(page.getByText("That code was not accepted.")).toBeVisible();
    await expect(page.getByText("Not enabled")).toBeVisible();
  });
});
