import { stepUpChallengeUrl } from "../src/features/security-step-up";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, test } from "./fixtures";
import { seedFacts } from "./shop-facts";
import {
  capture,
  installVisualBuildGuard,
  SURFACE_TIMEOUT_MS,
  VISUAL_STEP_BOUNDS,
} from "./visual-harness";

// WebAuthn rejects an IP-address RP ID, while the shared non-passkey fleet uses 127.0.0.1.
test.use({
  baseURL: async ({ workerBaseURL }, use) => {
    await use(workerBaseURL.replace("127.0.0.1", "localhost"));
  },
});

installVisualBuildGuard();
test.describe.configure({ timeout: SURFACE_TIMEOUT_MS });
test.use({
  ...VISUAL_STEP_BOUNDS,
  privateShopSlug: "staff-passkey-review",
  colorScheme: "light",
  viewport: { width: 1280, height: 800 },
});
const t = staffTranslator("en-US");

test.describe("light mode", () => {
  test("the optional staff passkey sign-in keeps the password primary", async ({ page }) => {
    const words = diverTranslator("en-US");
    await page.goto("/sign-in");
    await expect(
      page.getByRole("button", { name: words("account.signIn.passkey"), exact: true }),
    ).toBeVisible();
    await capture(page, "staff-passkey-sign-in", "light");
  });
  test("staff passkeys show empty, saved, deletion and fresh step-up states", async ({
    page,
    privateShop,
  }) => {
    const path = `/shop/${privateShop.slug}/me/security`;
    await seedFacts(page.request, ["staffSessionsSeenNow"], { slug: privateShop.slug });
    await page.goto(path);
    await expect(
      page.getByText(t("settings.security.passkeys.empty"), { exact: true }),
    ).toBeVisible();
    await capture(page, "staff-passkeys-empty", "light");
    // The pixel probe detaches its own CDP session, which resets WebAuthn on the target.
    // Keep real ceremonies between captures and carry the test key across that reset.
    const cdp = await page.context().newCDPSession(page);
    const createAuthenticator = async () => {
      await cdp.send("WebAuthn.enable");
      return (
        await cdp.send("WebAuthn.addVirtualAuthenticator", {
          options: {
            protocol: "ctap2",
            transport: "internal",
            hasResidentKey: true,
            hasUserVerification: true,
            isUserVerified: true,
            automaticPresenceSimulation: true,
          },
        })
      ).authenticatorId;
    };
    let authenticatorId: string | null = await createAuthenticator();
    try {
      await page
        .getByRole("textbox", { name: t("settings.security.passkeys.name"), exact: true })
        .fill("Dock phone");
      await page
        .getByRole("button", { name: t("settings.security.passkeys.add"), exact: true })
        .click();
      await expect(
        page.getByRole("button", { name: t("settings.security.passkeys.save"), exact: true }),
      ).toBeVisible();
      await page.reload();
      await expect(
        page
          .getByRole("textbox", { name: t("settings.security.passkeys.name"), exact: true })
          .first(),
      ).toHaveValue("Dock phone");
      const { credentials } = await cdp.send("WebAuthn.getCredentials", { authenticatorId });
      await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      authenticatorId = null;
      await capture(page, "staff-passkeys-saved", "light");
      authenticatorId = await createAuthenticator();
      for (const credential of credentials)
        await cdp.send("WebAuthn.addCredential", { authenticatorId, credential });
      await page
        .getByRole("button", { name: t("settings.security.passkeys.verify"), exact: true })
        .click();
      await expect(
        page.getByText(t("settings.security.factorManagement.verified"), { exact: true }),
      ).toBeVisible();
    } finally {
      if (authenticatorId)
        await cdp.send("WebAuthn.removeVirtualAuthenticator", { authenticatorId });
      await cdp.detach();
    }
    await page
      .getByRole("button", { name: t("settings.security.passkeys.delete"), exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: t("settings.security.passkeys.confirmDelete"),
        exact: true,
      }),
    ).toBeVisible();
    await capture(page, "staff-passkeys-delete-confirmation", "light");
    await page
      .getByRole("button", { name: t("settings.security.passkeys.cancel"), exact: true })
      .click();
    await page.goto(stepUpChallengeUrl(privateShop.slug, "export", path));
    await expect(
      page.getByRole("button", { name: t("settings.security.passkeys.verify"), exact: true }),
    ).toBeVisible();
    await capture(page, "staff-passkeys-step-up", "light");
  });
});
