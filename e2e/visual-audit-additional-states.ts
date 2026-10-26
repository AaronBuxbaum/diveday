import { DEV_STAFF_LOGINS } from "../src/db/dev-credentials";
import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { enrollSignInChallenge, startSignInChallenge } from "./auth-challenge";
import { expect, signedInAsOwner, test } from "./fixtures";
import type { AuditCapture } from "./visual-audit-capture";

const diver = diverTranslator("en-US");
const staff = staffTranslator("en-US");

export function registerAdditionalAuditCaptures(capture: AuditCapture) {
  test.describe("light mode — sign-in outcomes", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("sign-in renders its second-factor field beside the shop's schedule door", async ({
      page,
      privateShop,
    }) => {
      await enrollSignInChallenge(page, privateShop.slug);
      await startSignInChallenge(page, privateShop.ownerEmail);
      const callbackUrl = encodeURIComponent(`/shop/${privateShop.slug}/divers`);
      await page.goto(`/sign-in?error=two-factor&callbackUrl=${callbackUrl}`);
      await page.getByLabel(diver("account.signIn.twoFactorCode")).waitFor();
      await expect(
        page.getByRole("link", { name: diver("account.signIn.publicSchedule") }),
      ).toHaveAttribute("href", `/s/${privateShop.slug}`);
      await capture(page, "sign-in-second-factor", "light");
    });

    test("a refused sign-in renders the outcome beside the submit control", async ({ page }) => {
      await page.goto("/sign-in");
      await page.getByLabel("Email").fill(DEV_STAFF_LOGINS.owner.email);
      await page.getByLabel("Password").fill("wrong-password");
      await page.getByRole("button", { name: "Sign in", exact: true }).click();
      await page
        .getByRole("alert")
        .filter({ hasText: diver("account.signIn.error") })
        .waitFor();
      await capture(page, "sign-in-refused", "light");
    });

    test("the ended-session sign-in renders why the person was signed out", async ({ page }) => {
      await page.goto("/sign-in?session=ended");
      await page.getByText(diver("account.signIn.sessionEnded"), { exact: true }).waitFor();
      await capture(page, "sign-in-session-ended", "light");
    });
  });

  test.describe("light mode — public inline composers and receipts", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("find-my-booking renders its composer and generic sent receipt in place", async ({
      page,
    }) => {
      await page.goto("/s/blue-mantis");
      const composer = page.locator("#find-my-booking");
      await composer.getByText(diver("findMyBooking.heading"), { exact: true }).click();
      await composer.getByLabel("Email").fill("nora.review@example.com");
      await capture(page, "find-my-booking-composer", "light");
      await composer.getByRole("button", { name: "Send my link" }).click();
      await composer.getByRole("heading", { name: diver("findMyBooking.sentHeading") }).waitFor();
      await capture(page, "find-my-booking-sent", "light");
    });

    test("the last-minute list renders its composer and joined receipt in place", async ({
      page,
    }) => {
      await page.goto("/s/blue-mantis");
      const composer = page.locator("#last-minute-list");
      await composer.locator("summary").click();
      await composer.getByLabel("Name", { exact: true }).fill("Tess Alvarez");
      await composer.getByLabel("Email", { exact: true }).fill("tess.list.review@example.com");
      await composer.getByLabel("Certification level").selectOption("open_water");
      await capture(page, "last-minute-list-composer", "light");
      await composer.getByRole("button", { name: "Notify me" }).click();
      await composer.getByRole("heading", { name: diver("lastMinute.joinedHeading") }).waitFor();
      await capture(page, "last-minute-list-joined", "light");
    });
  });

  test.describe("light mode — additional staff disclosures", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the export bundle opens its complete file grid", async ({ page }) => {
      await page.goto("/shop/blue-mantis/settings/export");
      const summary = page
        .locator("summary")
        .filter({ hasText: staff("settings.export.bundle.heading") });
      await summary.click();
      await page.getByText("shop.csv", { exact: true }).waitFor();
      await capture(page, "settings-export-file-grid", "light");
    });

    test("a payment needing a check opens its Stripe reference", async ({ page, request }) => {
      const seeded = await request.post("/api/test/seed-trouble-states?owedRefund=1");
      expect(seeded.ok()).toBe(true);
      await page.goto("/shop/blue-mantis/orders");
      const checks = page.getByRole("region", { name: "Payments that need a check" });
      const reference = checks
        .locator("details")
        .filter({ hasText: staff("orders.index.paymentOps.reference") })
        .first();
      await reference.locator("> summary").click();
      await reference.locator("code").waitFor();
      await capture(page, "payment-check-stripe-reference", "light");
    });

    test("the dive-site editor opens its delete confirmation without submitting", async ({
      page,
    }) => {
      await page.goto("/shop/blue-mantis/dive-sites");
      await page.getByRole("link", { name: "Molasses Reef", exact: true }).first().click();
      await page.getByRole("heading", { level: 1, name: "Molasses Reef" }).waitFor();
      await page.locator("form[data-hydrated]").filter({ visible: true }).waitFor();
      await page
        .locator("summary")
        .filter({ hasText: staff("diveSites.edit.deleteSite") })
        .click();
      await page
        .getByRole("heading", { name: staff("diveSites.edit.deleteConfirmTitle") })
        .waitFor();
      await capture(page, "dive-site-delete-confirmation", "light");
    });
  });
}
