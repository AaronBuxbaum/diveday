import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import type { DiverLocale } from "../src/i18n/settings";
import { staffTranslator } from "../src/i18n/staff-messages";
import { DEMO_BYPASS_PASSWORD } from "../src/lib/demo-bypass";
import { totpCode } from "../src/lib/totp";
import { expect } from "./fixtures";
import { signOut } from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";

/** Enrollment belongs to a per-test minted owner, never the shared demo. */
export async function enrollSignInChallenge(page: Page, shopSlug: string) {
  await page.goto(`/shop/${shopSlug}/settings/security`);
  await page
    .locator("summary")
    .filter({ hasText: staffTranslator("en-US")("settings.security.setupDisclosure") })
    .click();
  await page.getByRole("button", { name: "Start setup", exact: true }).click();
  await expect(page.getByRole("textbox", { name: "Authenticator code" })).toBeVisible();
  const secret = (await page.locator("code").first().innerText()).trim();
  await page
    .getByRole("textbox", { name: "Authenticator code" })
    .fill(totpCode(secret, Date.parse(E2E_FROZEN_CLOCK)));
  await page.getByRole("button", { name: "Enable", exact: true }).click();
  await expect(page.getByRole("button", { name: "Disable two-factor", exact: true })).toBeVisible();
  const recoveryCodes = (await page.locator("code").allTextContents()).map((code) => code.trim());
  expect(recoveryCodes).toHaveLength(10);
  await signOut(page);
  return { secret, recoveryCodes };
}

export async function startSignInChallenge(
  page: Page,
  email: string,
  locale: DiverLocale = "en-US",
) {
  const words = diverTranslator(locale);
  await page.goto("/sign-in");
  await page.getByLabel(words("account.common.email"), { exact: true }).fill(email);
  await page
    .getByLabel(words("account.common.password"), { exact: true })
    .fill(DEMO_BYPASS_PASSWORD);
  await page.getByRole("button", { name: words("account.signIn.submit"), exact: true }).click();
  await expect(page).toHaveURL(/\/sign-in\?error=two-factor$/);
  await expect(
    page.getByRole("heading", { level: 1, name: words("account.signIn.twoFactorTitle") }),
  ).toBeVisible();
  await expect(page.locator('input[name="password"], input[name="email"]')).toHaveCount(0);
  await expect(
    page.getByRole("textbox", { name: words("account.signIn.twoFactorCode") }),
  ).toBeFocused();
  const cookies = await page.context().cookies();
  expect(
    cookies.some(
      (cookie) => cookie.name.endsWith("session_token") || cookie.name.endsWith("session_data"),
    ),
  ).toBe(false);
  const pending = cookies.find((cookie) => cookie.name.endsWith("pending_sign_in"));
  expect(pending).toMatchObject({ httpOnly: true, sameSite: "Strict", path: "/" });
  return pending;
}
