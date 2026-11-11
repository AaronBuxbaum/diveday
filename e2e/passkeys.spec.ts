import { stepUpChallengeUrl } from "../src/features/security-step-up";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { DEMO_BYPASS_PASSWORD } from "../src/lib/demo-bypass";
import { enrollSignInChallenge } from "./auth-challenge";
import { test as base, expect } from "./fixtures";
import { signOut } from "./helpers";
import { closePasskeyAuthenticator } from "./passkey-authenticator";

const staff = staffTranslator("en-US");
const diver = diverTranslator("en-US");

const test = base.extend<{ virtualPasskey: string; registeredPasskey: string }>({
  virtualPasskey: async ({ page }, use) => {
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("WebAuthn.enable");
    const { authenticatorId } = await cdp.send("WebAuthn.addVirtualAuthenticator", {
      options: {
        protocol: "ctap2",
        transport: "internal",
        hasResidentKey: true,
        hasUserVerification: true,
        isUserVerified: true,
        automaticPresenceSimulation: true,
      },
    });
    try {
      await use(authenticatorId);
    } finally {
      await closePasskeyAuthenticator(page, cdp, authenticatorId);
    }
  },
  registeredPasskey: async ({ page, privateShop, virtualPasskey: _virtualPasskey }, use) => {
    const path = `/shop/${privateShop.slug}/me/security`;
    await page.goto(path);
    await expect(
      page.getByRole("heading", { name: staff("settings.security.passkeys.heading"), exact: true }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: staff("settings.security.passkeys.name"), exact: true })
      .fill("My phone");
    await page
      .getByRole("button", { name: staff("settings.security.passkeys.add"), exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: staff("settings.security.passkeys.save"), exact: true }),
    ).toBeVisible();
    await use(path);
  },
});

// WebAuthn rejects an IP-address RP ID, while the shared non-passkey fleet uses 127.0.0.1.
test.use({
  baseURL: async ({ workerBaseURL }, use) => {
    await use(workerBaseURL.replace("127.0.0.1", "localhost"));
  },
});

// CI reached Delete at 14.4s of the unchanged 15s budget, before its second sign-out and
// password recovery. Keep these independent journeys bounded; enrollment still uses the real UI.
test("staff rename a saved passkey and explicitly confirm or cancel its deletion", async ({
  page,
  registeredPasskey,
}) => {
  const savedName = page
    .getByRole("textbox", { name: staff("settings.security.passkeys.name"), exact: true })
    .first();
  await savedName.fill("Dock phone");
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.save"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.passkeys.saved"), { exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(savedName).toHaveValue("Dock phone");
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.verify"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.factorManagement.verified"), { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.delete"), exact: true })
    .click();
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.cancel"), exact: true })
    .click();
  await expect(savedName).toHaveValue("Dock phone");
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.delete"), exact: true })
    .click();
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.confirmDelete"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.passkeys.empty"), { exact: true }),
  ).toBeVisible();
  await expect(page).toHaveURL(new RegExp(`${registeredPasskey}$`));
});

test("a passkey signs staff in and verifies an export step-up in that session", async ({
  page,
  privateShop,
  registeredPasskey,
}) => {
  await signOut(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: diver("account.signIn.passkey"), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
  await page.goto(stepUpChallengeUrl(privateShop.slug, "export", registeredPasskey));
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.verify"), exact: true })
    .click();
  await expect(page).toHaveURL(new RegExp(`${registeredPasskey}$`));
});

test("a revoked passkey refuses sign-in while the password door still works", async ({
  page,
  privateShop,
  registeredPasskey: _registeredPasskey,
}) => {
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.verify"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.factorManagement.verified"), { exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.delete"), exact: true })
    .click();
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.confirmDelete"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.passkeys.empty"), { exact: true }),
  ).toBeVisible();
  await signOut(page);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: diver("account.signIn.passkey"), exact: true }).click();
  await expect(page.getByText(diver("account.signIn.passkeyError"), { exact: true })).toBeVisible();
  await page
    .getByLabel(diver("account.common.email"), { exact: true })
    .fill(privateShop.ownerEmail);
  await page
    .getByLabel(diver("account.common.password"), { exact: true })
    .fill(DEMO_BYPASS_PASSWORD);
  await page.getByRole("button", { name: diver("account.signIn.submit"), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
});

test("a passkey sign-in still requires enabled two-factor authentication", async ({
  page,
  privateShop,
  registeredPasskey: _registeredPasskey,
}) => {
  await page
    .getByRole("button", { name: staff("settings.security.passkeys.verify"), exact: true })
    .click();
  await expect(
    page.getByText(staff("settings.security.factorManagement.verified"), { exact: true }),
  ).toBeVisible();
  const { recoveryCodes } = await enrollSignInChallenge(page, privateShop.slug);
  await page.goto("/sign-in");
  await page.getByRole("button", { name: diver("account.signIn.passkey"), exact: true }).click();
  await expect(
    page.getByRole("textbox", { name: diver("account.signIn.twoFactorCode") }),
  ).toBeVisible();
  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (cookie) => cookie.name.endsWith("session_token") || cookie.name.endsWith("session_data"),
    ),
  ).toBe(false);
  await page
    .getByRole("textbox", { name: diver("account.signIn.twoFactorCode") })
    .fill(recoveryCodes[0]);
  await page.getByRole("button", { name: diver("account.signIn.verify"), exact: true }).click();
  await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}$`));
});

test("an unsupported browser keeps the password and recovery doors", async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(window, "PublicKeyCredential", { value: undefined, configurable: true });
  });
  await page.goto("/sign-in");
  await expect(page.getByLabel(diver("account.common.email"), { exact: true })).toBeVisible();
  await expect(page.getByLabel(diver("account.common.password"), { exact: true })).toBeVisible();
  await expect(
    page.getByRole("link", { name: diver("account.signIn.forgotPassword"), exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: diver("account.signIn.passkey"), exact: true }),
  ).toHaveCount(0);
});
