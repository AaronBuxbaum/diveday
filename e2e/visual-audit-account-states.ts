import type { Page } from "@playwright/test";
import { diverTranslator } from "../src/i18n/messages";
import { expect, test } from "./fixtures";
import { mintOnboardFormPath } from "./setup-link";
import type { AuditCapture } from "./visual-audit-capture";

const copy = diverTranslator("en-US");

async function accountLink(page: Page, email: string, purpose: string) {
  const seeded = await page.request.post("/api/test/seed-account-token", {
    data: { email, purpose },
  });
  expect(seeded.ok()).toBe(true);
  return ((await seeded.json()) as { token: string }).token;
}

async function visualLink(page: Page, shopSlug: string, family: string, state = "active") {
  const seeded = await page.request.post("/api/test/seed-visual-links", {
    data: { shopSlug, family, state },
  });
  expect(seeded.ok()).toBe(true);
  return ((await seeded.json()) as { path: string }).path;
}

/** Real one-shot links are grouped only where consumption creates the next state. */
export function registerAccountAuditCaptures(capture: AuditCapture, flowTimeout: number) {
  test.describe("light mode — account and consent outcomes", () => {
    test.use({
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-review-accounts",
    });

    test("email verification renders before and after its one-time confirmation", async ({
      page,
      privateShop,
    }) => {
      const token = await accountLink(page, privateShop.ownerEmail, "email_verification");
      await page.goto(`/verify/${token}`);
      await page.getByRole("button", { name: "Confirm my email" }).waitFor();
      await capture(page, "account-verify-active", "light");
      await page.getByRole("button", { name: "Confirm my email" }).click();
      await expect(page.getByRole("heading", { name: "Email confirmed" })).toBeVisible();
      await capture(page, "account-verify-confirmed", "light");
      await page.goto(`/verify/${token}`);
      await page.getByRole("heading", { name: copy("common.deadLinkHeading") }).waitFor();
      await capture(page, "account-verify-consumed", "light");
    });

    test("a password-reset link renders its live form and its consumed door", async ({
      page,
      privateShop,
    }) => {
      const token = await accountLink(page, privateShop.ownerEmail, "password_reset");
      await page.goto(`/reset-password/${token}`);
      await page.getByRole("button", { name: "Set new password" }).waitFor();
      await capture(page, "account-reset-active", "light");
      await page.goto(`/reset-password/${token}?error=password_too_short`);
      await expect(page.getByLabel("New password", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await capture(page, "account-reset-password-too-short", "light");
      await page.goto(`/reset-password/${token}?error=passwords_mismatch`);
      await expect(page.getByLabel("Confirm new password")).toHaveAttribute("aria-invalid", "true");
      await capture(page, "account-reset-passwords-mismatch", "light");
      await page.getByLabel("New password", { exact: true }).fill("reef-review-password-123");
      await page.getByLabel("Confirm new password").fill("reef-review-password-123");
      await page.getByRole("button", { name: "Set new password" }).click();
      await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}`));
      await page.goto(`/reset-password/${token}`);
      await page.getByRole("heading", { name: copy("common.deadLinkHeading") }).waitFor();
      await capture(page, "account-reset-consumed", "light");
    });

    test("a staff invite renders its consumed door after the invited person signs in", async ({
      page,
      privateShop,
    }) => {
      // Minting a shop, inviting a real account and accepting its link is the
      // same sequential journey as staff-invite.spec.ts, before either shot.
      test.setTimeout(flowTimeout);
      const email = "review-instructor@example.com";
      await page.goto(`/shop/${privateShop.slug}/settings/team`);
      const invite = page.locator("#invite");
      await invite.locator("summary").click();
      await invite.getByLabel("Full name").fill("Rosa Delgado");
      await invite.getByLabel("Email").fill(email);
      await invite.getByLabel("Instructor", { exact: true }).check();
      await invite.getByRole("button", { name: "Send invite" }).click();
      await expect(page.getByText("Invite sent")).toBeVisible();
      const token = await accountLink(page, email, "invite");
      await page.goto(`/invite/${token}`);
      await page.getByRole("button", { name: "Set password & sign in" }).waitFor();
      await capture(page, "account-invite-active", "light");
      await page.goto(`/invite/${token}?error=password_too_short`);
      await expect(page.getByLabel("Password", { exact: true })).toHaveAttribute(
        "aria-invalid",
        "true",
      );
      await capture(page, "account-invite-password-too-short", "light");
      await page.goto(`/invite/${token}?error=passwords_mismatch`);
      await expect(page.getByLabel("Confirm password")).toHaveAttribute("aria-invalid", "true");
      await capture(page, "account-invite-passwords-mismatch", "light");
      await page.getByLabel("Password", { exact: true }).fill("reef-review-password-123");
      await page.getByLabel("Confirm password").fill("reef-review-password-123");
      await page.getByRole("button", { name: "Set password & sign in" }).click();
      await expect(page).toHaveURL(new RegExp(`/shop/${privateShop.slug}`));
      await page.goto(`/invite/${token}`);
      await page.getByRole("heading", { name: copy("common.deadLinkHeading") }).waitFor();
      await capture(page, "account-invite-consumed", "light");
    });

    test("the front-desk address confirmation renders its question and saved outcome", async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/settings#contact`);
      await page.getByLabel("Contact email").fill("desk.review@example.com");
      await page.getByRole("button", { name: "Save contact details" }).click();
      await expect(page.getByText("Awaiting confirmation")).toBeVisible();
      const seeded = await page.request.post("/api/test/seed-contact-email-confirmation-token", {
        data: { shopSlug: privateShop.slug },
      });
      expect(seeded.ok()).toBe(true);
      const { token } = (await seeded.json()) as { token: string };
      await page.goto(`/confirm-contact/${token}`);
      await page.getByRole("button", { name: copy("contactConfirm.submit") }).waitFor();
      await capture(page, "contact-confirm-active", "light");
      await page.getByRole("button", { name: copy("contactConfirm.submit") }).click();
      await page.getByRole("heading", { name: copy("contactConfirm.confirmedTitle") }).waitFor();
      await capture(page, "contact-confirm-saved", "light");
      await page.goto(`/confirm-contact/${token}`);
      await expect(
        page.getByRole("heading", { name: copy("contactConfirm.confirmedTitle") }),
      ).toBeVisible();
    });

    for (const family of ["shore", "bookkeeper"] as const) {
      test(`${family} address confirmation renders its question and saved outcome`, async ({
        page,
        privateShop,
      }) => {
        const path = await visualLink(page, privateShop.slug, `${family}-confirm`);
        await page.goto(path);
        const submit = copy(
          family === "shore" ? "shoreConfirm.submit" : "bookkeeperConfirm.submit",
        );
        await page.getByRole("button", { name: submit }).waitFor();
        if (family === "shore") await capture(page, "shore-confirm-active", "light");
        else await capture(page, "bookkeeper-confirm-active", "light");
        await page.getByRole("button", { name: submit }).click();
        const title =
          family === "shore" ? "shoreConfirm.confirmedTitle" : "bookkeeperConfirm.confirmedTitle";
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          copy(title, { shopName: "Reef Review Accounts" }),
        );
        if (family === "shore") await capture(page, "shore-confirm-saved", "light");
        else await capture(page, "bookkeeper-confirm-saved", "light");
        await page.goto(path);
        await expect(page.getByRole("heading", { level: 1 })).toHaveText(
          copy(title, { shopName: "Reef Review Accounts" }),
        );
      });

      test(`an expired ${family} confirmation renders the dead-link page`, async ({
        page,
        privateShop,
      }) => {
        await page.goto(await visualLink(page, privateShop.slug, `${family}-confirm`, "expired"));
        await page
          .getByRole("heading", {
            name: copy("common.deadLinkHeading"),
          })
          .waitFor();
        if (family === "shore") await capture(page, "shore-confirm-expired", "light");
        else await capture(page, "bookkeeper-confirm-expired", "light");
      });
    }

    for (const family of ["digest", "shore-stop", "bookkeeper-stop"] as const) {
      test(`${family} opt-out renders its question and saved outcome`, async ({
        page,
        privateShop,
      }) => {
        const path = await visualLink(page, privateShop.slug, family);
        const submit = copy(
          family === "digest"
            ? "weeklyDigestUnsubscribe.submit"
            : family === "shore-stop"
              ? "shoreAlertStop.submit"
              : "bookkeeperStop.submit",
        );
        const title = copy(
          family === "digest"
            ? "weeklyDigestUnsubscribe.confirmedTitle"
            : family === "shore-stop"
              ? "shoreAlertStop.confirmedTitle"
              : "bookkeeperStop.confirmedTitle",
        );
        await page.goto(path);
        await page.getByRole("button", { name: submit }).waitFor();
        if (family === "digest") await capture(page, "digest-unsubscribe-active", "light");
        else if (family === "shore-stop")
          await capture(page, "shore-stop-unsubscribe-active", "light");
        else await capture(page, "bookkeeper-stop-unsubscribe-active", "light");
        await page.getByRole("button", { name: submit }).click();
        await page.getByRole("heading", { name: title }).waitFor();
        if (family === "digest") await capture(page, "digest-unsubscribe-saved", "light");
        else if (family === "shore-stop")
          await capture(page, "shore-stop-unsubscribe-saved", "light");
        else await capture(page, "bookkeeper-stop-unsubscribe-saved", "light");
        await page.goto(path);
        await expect(page.getByRole("heading", { name: title })).toBeVisible();
      });
    }
  });

  test.describe("light mode — public opt-out outcomes", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });
    for (const family of ["courtesy", "last-minute"] as const) {
      test(`${family} email opt-out renders its question and saved outcome`, async ({ page }) => {
        const email = `${family}.review@example.com`;
        await page.goto("/s/blue-mantis");
        const list = page.locator("#last-minute-list");
        await list.locator("summary").click();
        await list.getByLabel("Name").fill("Uma Torres");
        await list.getByLabel("Email").fill(email);
        await page.getByRole("button", { name: "Notify me" }).click();
        await expect(page.getByRole("heading", { name: "You’re on the list" })).toBeVisible();
        const endpoint =
          family === "courtesy"
            ? "seed-courtesy-email-unsubscribe-token"
            : "seed-interest-unsubscribe-token";
        const seeded = await page.request.post(`/api/test/${endpoint}`, {
          data: { shopSlug: "blue-mantis", email },
        });
        expect(seeded.ok()).toBe(true);
        const { token } = (await seeded.json()) as { token: string };
        await page.goto(`/unsubscribe/${token}`);
        await page.getByRole("button", { name: "Stop these emails" }).waitFor();
        if (family === "courtesy") await capture(page, "courtesy-unsubscribe-active", "light");
        else await capture(page, "last-minute-unsubscribe-active", "light");
        await page.getByRole("button", { name: "Stop these emails" }).click();
        await page.getByRole("heading", { name: "You’re unsubscribed" }).waitFor();
        if (family === "courtesy") await capture(page, "courtesy-unsubscribe-saved", "light");
        else await capture(page, "last-minute-unsubscribe-saved", "light");
        await page.goto(`/unsubscribe/${token}`);
        await expect(page.getByRole("heading", { name: "You’re unsubscribed" })).toBeVisible();
      });
    }

    test("a new shop renders empty lists and its consumed setup door", async ({ page }) => {
      // Real onboarding creates the empty world; the seeded privateShop has
      // divers and orders already. Its fixed identity keeps the images stable.
      test.setTimeout(flowTimeout);
      const slug = "first-light-review";
      const setup = await mintOnboardFormPath(page);
      await page.goto(setup);
      await page.locator('input[name="shopName"]').fill("First Light Review");
      await page.locator('input[name="shopSlug"]').fill(slug);
      await page.locator('input[name="ownerName"]').fill("Nour Haddad");
      await page.locator('input[name="ownerEmail"]').fill("first-light.review@example.com");
      await page.locator('input[name="ownerPassword"]').fill("reef-review-password-123");
      await page.getByRole("button", { name: "Create shop & start trial" }).click();
      await expect(page).toHaveURL(new RegExp(`/shop/${slug}$`));
      await page.goto(`/shop/${slug}/divers`);
      await page.getByText("No divers on file yet", { exact: true }).waitFor();
      await capture(page, "divers-first-run-empty", "light");
      await page.goto(`/shop/${slug}/orders`);
      await page.getByText("No orders yet", { exact: true }).waitFor();
      await capture(page, "orders-first-run-empty", "light");
      await page.goto(setup);
      await expect(page).toHaveURL(/\/get-set-up\?from=onboard-closed$/);
      await page.getByLabel("Shop name").waitFor();
      await capture(page, "onboard-consumed-link", "light");
    });
  });
}
