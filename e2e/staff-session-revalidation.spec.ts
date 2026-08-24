import { DEMO_BYPASS_PASSWORD } from "../src/lib/demo-bypass";
import { DEMO_EMAIL_DOMAIN } from "../src/lib/demo-identity";
import { expect, makeActivitySafe, test } from "./fixtures";
import { signInAs } from "./helpers";

/**
 * **Issue #701.** Sessions are stateless 30-day JWTs with no built-in
 * re-validation. Before `requireStaffSession()` re-read the account live
 * (`src/lib/session.ts`), disabling a staff account from the team page left
 * their already-issued session working on every ordinary `/shop/**` surface
 * for up to 30 days — closed here, and the fix's own failure mode (an
 * infinite redirect loop between the edge proxy's stale-JWT shortcut and the
 * node layer's live check) is what the second test guards.
 *
 * Disabling a staff account is shop-wide **configuration**, not the
 * `demoReset` schedule fixture reset covers — so this takes a private shop of
 * its own rather than the shared blue-mantis fixture (ADR
 * 20260815-per-test-private-shops). The slug stays random (the fixture's own
 * default for a behavioral spec) — the seeded captain's email is built from
 * `privateShop.slug` once it's known, not pinned in advance.
 */
test.describe("a disabled staff account loses its live session", () => {
  test("the disabled staffer's own next request is bounced to sign-in, not silently served", async ({
    page,
    privateShop,
    browser,
    workerBaseURL,
  }) => {
    test.setTimeout(45_000);
    const captainEmail = `sal@${privateShop.slug}.${DEMO_EMAIL_DOMAIN}`;

    // The captain's own session, held on a separate browser profile — the
    // account this test disables out from under it.
    const captainContext = await browser.newContext({ baseURL: workerBaseURL });
    const captainPage = makeActivitySafe(await captainContext.newPage());
    await signInAs(captainPage, { email: captainEmail, password: DEMO_BYPASS_PASSWORD });
    await captainPage.goto(`/shop/${privateShop.slug}/divers`);
    await expect(captainPage.getByRole("heading", { name: "Divers" })).toBeVisible();

    // The owner (`page`, signed in by the `privateShop` fixture) disables Sal
    // Moretti from the team page — a real admin action through the real UI,
    // not a database shortcut.
    await page.goto(`/shop/${privateShop.slug}/settings/team`);
    await page.getByRole("button", { name: "Disable Sal Moretti" }).click();
    await expect(page.getByText("Account disabled — they can no longer sign in.")).toBeVisible();

    // The captain's browser still holds its original, unchanged cookie — no
    // sign-out happened on that profile. Its very next request is what must
    // now refuse, since nothing about the JWT itself changed.
    await captainPage.goto(`/shop/${privateShop.slug}/divers`);
    await expect(captainPage).toHaveURL(/\/sign-in\?session=ended$/);
    await expect(
      captainPage.getByText("You've been signed out because this account is no longer active."),
    ).toBeVisible();

    await captainContext.close();
  });

  test("the forced sign-in page does not bounce back to /shop and loop", async ({
    page,
    privateShop,
    browser,
    workerBaseURL,
  }) => {
    test.setTimeout(45_000);
    const captainEmail = `sal@${privateShop.slug}.${DEMO_EMAIL_DOMAIN}`;

    const captainContext = await browser.newContext({ baseURL: workerBaseURL });
    const captainPage = makeActivitySafe(await captainContext.newPage());
    await signInAs(captainPage, { email: captainEmail, password: DEMO_BYPASS_PASSWORD });

    await page.goto(`/shop/${privateShop.slug}/settings/team`);
    await page.getByRole("button", { name: "Disable Sal Moretti" }).click();
    await expect(page.getByText("Account disabled — they can no longer sign in.")).toBeVisible();

    // Same still-stale cookie, visited directly at the sign-in page this
    // time. The edge `authorized()` callback (src/lib/auth.config.ts) still
    // sees an `isStaff`-shaped JWT here — it has no database access and
    // cannot know the account was disabled — so its ordinary "already signed
    // in" shortcut would otherwise bounce this straight back to
    // `/shop/<slug>`, which `requireStaffSession()` would immediately refuse
    // again. Landing on the real sign-in form, once, is what proves that
    // loop is broken rather than merely not-yet-observed.
    await captainPage.goto("/sign-in?session=ended");
    await expect(captainPage).toHaveURL(/\/sign-in\?session=ended$/);
    await expect(captainPage.getByRole("heading", { name: "Welcome back" })).toBeVisible();

    await captainContext.close();
  });
});
