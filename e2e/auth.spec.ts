import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { diverTranslator } from "../src/i18n/messages";
import { DEMO_BYPASS_PASSWORD } from "../src/lib/demo-bypass";
import { enrollSignInChallenge, startSignInChallenge } from "./auth-challenge";
import { expect, makeActivitySafe, READ_ONLY, test } from "./fixtures";
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

test.describe("pending second-factor sign-in", () => {
  // Private mint plus actual enrollment and two-stage sign-in exceed an ordinary one-page walk.
  test.setTimeout(60_000);

  test("keeps only the code form and accepts a recovery code after a refused code", async ({
    page,
    privateShop,
  }) => {
    const enrolled = await enrollSignInChallenge(page, privateShop.slug);
    await startSignInChallenge(page, privateShop.ownerEmail);
    const words = diverTranslator("en-US");
    await page.getByRole("textbox", { name: words("account.signIn.twoFactorCode") }).fill("AAAAAA");
    await page.getByRole("button", { name: words("account.signIn.verify"), exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?error=invalid-code$/);
    await expect(
      page.getByRole("alert").filter({ hasText: words("account.signIn.invalidCode") }),
    ).toBeVisible();
    await expect(page.locator('input[name="password"], input[name="email"]')).toHaveCount(0);
    await page
      .getByRole("textbox", { name: words("account.signIn.twoFactorCode") })
      .fill(enrolled.recoveryCodes[0]);
    await page.getByRole("button", { name: words("account.signIn.verify"), exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
    const cookies = await page.context().cookies();
    expect(cookies.some((cookie) => cookie.name.endsWith("pending_sign_in"))).toBe(false);
    expect(cookies.some((cookie) => cookie.name.endsWith("session_token"))).toBe(true);
  });

  test("Back revokes proof and a forged query cannot manufacture the code step", async ({
    page,
    privateShop,
  }) => {
    await enrollSignInChallenge(page, privateShop.slug);
    const pending = await startSignInChallenge(page, privateShop.ownerEmail);
    await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in$/);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    if (!pending) throw new Error("pending cookie missing");
    await page.context().addCookies([pending]);
    await page.goto("/sign-in?error=two-factor");
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    await expect(page.getByRole("textbox", { name: "Sign-in code" })).toHaveCount(0);
    await expect(
      page
        .getByRole("alert")
        .filter({ hasText: diverTranslator("en-US")("account.signIn.restart") }),
    ).toBeVisible();
  });

  test("an expired proof returns to credentials and refuses its formerly valid recovery code", async ({
    page,
    privateShop,
  }) => {
    const enrolled = await enrollSignInChallenge(page, privateShop.slug);
    await startSignInChallenge(page, privateShop.ownerEmail);
    expect(
      (
        await page.request.post(
          `/api/test/seed-trouble-states?authChallengeState=expired&shop=${privateShop.slug}`,
        )
      ).ok(),
    ).toBe(true);
    await page.getByRole("textbox", { name: "Sign-in code" }).fill(enrolled.recoveryCodes[0]);
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?error=restart$/);
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.endsWith("session_token")),
    ).toBe(false);
  });

  test("a pending retry hides the old refusal and shows the settled refusal again", async ({
    page,
    privateShop,
  }) => {
    await enrollSignInChallenge(page, privateShop.slug);
    await startSignInChallenge(page, privateShop.ownerEmail);
    const refusal = page
      .getByRole("alert")
      .filter({ hasText: diverTranslator("en-US")("account.signIn.invalidCode") });
    await page.getByRole("textbox", { name: "Sign-in code" }).fill("AAAAAA");
    await page.getByRole("button", { name: "Verify", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?error=invalid-code$/);
    await expect(refusal).toBeVisible();
    let release!: () => void;
    let continued!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const delivered = new Promise<void>((resolve) => {
      continued = resolve;
    });
    await page.route("**/sign-in*", async (route) => {
      if (route.request().method() === "POST") {
        await gate;
        await route.continue();
        continued();
      } else await route.continue();
    });
    try {
      await page.getByRole("textbox", { name: "Sign-in code" }).fill("BBBBBB");
      await page.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(page.getByRole("button", { name: "Signing in…", exact: true })).toBeDisabled();
      await expect(refusal).toBeHidden();
    } finally {
      release();
      await delivered;
      await page.unroute("**/sign-in*");
    }
    await expect(page.getByRole("button", { name: "Verify", exact: true })).toBeEnabled();
    await expect(refusal).toBeVisible();
  });

  test("switching from account A to pending account B clears browser authentication", async ({
    page,
    privateShop,
  }) => {
    await enrollSignInChallenge(page, privateShop.slug);
    const captainEmail = DEV_STAFF_LOGINS.captain.email.replace(
      "@demo.invalid",
      `@${privateShop.slug}.demo.invalid`,
    );
    await page.goto("/sign-in");
    await page.getByLabel("Email", { exact: true }).fill(captainEmail);
    await page.getByLabel("Password", { exact: true }).fill(DEMO_BYPASS_PASSWORD);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.endsWith("session_token")),
    ).toBe(true);
    await page.getByRole("button", { name: "Switch role", exact: true }).click();
    await page.getByRole("button", { name: "Switch to Owner", exact: true }).click();
    await expect(page).toHaveURL(/\/sign-in\?error=two-factor$/);
    await expect(page.getByRole("textbox", { name: "Sign-in code" })).toBeVisible();
    expect(
      (await page.context().cookies()).some(
        (cookie) => cookie.name.endsWith("session_token") || cookie.name.endsWith("session_data"),
      ),
    ).toBe(false);
    await page.getByRole("button", { name: "Back to sign in", exact: true }).click();
    await expect(page.getByLabel("Password", { exact: true })).toBeVisible();
    expect(
      (await page.context().cookies()).some((cookie) => cookie.name.endsWith("session_token")),
    ).toBe(false);
  });

  test("native forms finish the code-only flow without JavaScript", async ({
    page,
    browser,
    privateShop,
  }) => {
    const enrolled = await enrollSignInChallenge(page, privateShop.slug);
    // A separate raw context is intentional: fixture pages require staff hydration, which cannot run with JavaScript disabled.
    const native = await browser.newContext({
      javaScriptEnabled: false,
      baseURL: new URL(page.url()).origin,
    });
    try {
      const nativePage = makeActivitySafe(await native.newPage());
      await nativePage.goto("/sign-in");
      await expect(nativePage.getByLabel("Email", { exact: true })).toBeVisible();
      await nativePage.getByLabel("Email", { exact: true }).fill(privateShop.ownerEmail);
      await nativePage.getByLabel("Password", { exact: true }).fill(DEMO_BYPASS_PASSWORD);
      await nativePage.getByRole("button", { name: "Sign in", exact: true }).click();
      await expect(nativePage).toHaveURL(/\/sign-in\?error=two-factor$/);
      await expect(nativePage.locator('input[name="password"], input[name="email"]')).toHaveCount(
        0,
      );
      await nativePage
        .getByRole("textbox", { name: "Sign-in code" })
        .fill(enrolled.recoveryCodes[0]);
      await nativePage.getByRole("button", { name: "Verify", exact: true }).click();
      await expect(nativePage).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
    } finally {
      await native.close();
    }
  });
});
