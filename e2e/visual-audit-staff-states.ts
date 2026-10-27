import { diverTranslator } from "../src/i18n/messages";
import { staffTranslator } from "../src/i18n/staff-messages";
import { stepUpChallengeUrl } from "../src/lib/security-step-up";
import { TOTP_DRIFT_STEPS, TOTP_STEP_SECONDS, totpCode } from "../src/lib/totp";
import { clearCourseForms } from "./course-form-only";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookASeatAndOpenThread,
  bookOpenWaterSession,
  openThreadStep,
  publicTripUrl,
  requireCourseForm,
  scheduleCrewedOpenWaterSession,
  signOut,
  tripPathByTitle,
  writeCourseForm,
} from "./helpers";
import { E2E_FROZEN_CLOCK } from "./servers";
import type { AuditCapture } from "./visual-audit-capture";

const copy = staffTranslator("en-US");
const diverCopy = diverTranslator("en-US");

export function registerStaffAuditCaptures(capture: AuditCapture, flowTimeout: number) {
  test.describe("light mode — staff interactive outcomes", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the palette renders its pending query without the previous results", async ({ page }) => {
      await page.goto("/shop/blue-mantis");
      await page.getByRole("button", { name: "Search" }).click();
      const box = page.getByRole("combobox", { name: /Search divers/ });
      const dialog = page.getByRole("dialog");
      await box.fill("Priya Sharma");
      await dialog.getByRole("option", { name: "Priya Sharma", exact: true }).waitFor();
      let release = () => {};
      const blocked = new Promise<void>((resolve) => {
        release = resolve;
      });
      await page.route("**/api/search?q=zz-pending", async (route) => {
        await blocked;
        await route.fulfill({
          json: { divers: [], trips: [], diveSites: [], courses: [], orders: [], gear: [] },
        });
      });
      try {
        await box.fill("zz-pending");
        await dialog
          .getByText(copy("shared.commandPalette.searching"), { exact: true })
          .last()
          .waitFor();
        await expect(dialog.getByRole("option", { name: "Priya Sharma", exact: true })).toHaveCount(
          0,
        );
        await capture(page, "search-palette-pending", "light");
      } finally {
        release();
        await page.unrouteAll({ behavior: "wait" });
      }
    });

    test("a work-order line renders its menu and inline price editor", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear/work-orders");
      await page
        .getByRole("link", { name: /Breathes wet at depth/ })
        .first()
        .click();
      await page.getByRole("heading", { name: "Parts and labor" }).waitFor();
      await page.getByText(copy("workOrders.detail.addPartOrLabor"), { exact: true }).click();
      await page.getByLabel("Description").last().fill("Second-stage service kit");
      await page.getByLabel("Price each").last().fill("42");
      await page.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("Line added")).toBeVisible();
      await page.getByRole("button", { name: "Change Second-stage service kit" }).last().click();
      await page.getByRole("button", { name: "Edit", exact: true }).waitFor();
      await capture(page, "work-order-line-menu", "light");
      await page.getByRole("button", { name: "Edit", exact: true }).click();
      await page.locator("[data-row-menu]").getByLabel("Price each").waitFor();
      await capture(page, "work-order-line-editor", "light");
    });

    test("a duplicate gear tag renders its refusal beside the preserved fields", async ({
      page,
    }) => {
      // Add a unit is a sheet over the register (visual review A48), opened
      // by the header's door once React owns it; after a save the sheet may
      // still be open with its notice, so the door is only used when it is not.
      const addUnit = page.getByRole("dialog", { name: copy("gear.addUnit.title") });
      const tag = addUnit.getByRole("textbox", {
        name: `${copy("gear.form.label")} ${copy("gear.form.labelHint")}`,
        exact: true,
      });
      const open = async () => {
        if (!(await addUnit.isVisible())) {
          const door = page.getByRole("button", { name: "Add a unit", exact: true });
          await expect(door).toHaveAttribute("data-hydrated", "true");
          await door.click();
        }
        await tag.waitFor();
      };
      await page.goto("/shop/blue-mantis/gear");
      await open();
      await tag.fill("Review regulator");
      await page.getByRole("button", { name: "Add to the register" }).click();
      await expect(page.getByRole("link", { name: "Review regulator", exact: true })).toBeVisible();
      await open();
      await tag.fill("Review regulator");
      await page.getByLabel("Serial number").fill("SN-4471");
      await page.getByLabel("Brand & model").fill("Apeks XTX50");
      await page.getByRole("button", { name: "Add to the register" }).click();
      await expect(tag).toHaveAttribute("aria-invalid", "true");
      await capture(page, "gear-duplicate-tag-refusal", "light");
    });

    test("deleting a work order renders the board's durable Undo", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear/work-orders");
      await page
        .getByRole("link", { name: /Second stage free-flows on the surface/ })
        .first()
        .click();
      await page.getByRole("button", { name: "Delete work order" }).click();
      await expect(page.getByText("Work order deleted")).toBeVisible();
      await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
      await capture(page, "work-order-deleted-undo", "light");
    });

    test("a student's course form renders before and after signing", async ({ page }) => {
      // Authoring, requirement selection, a session and a public booking are
      // the sequential setup from course-forms.spec.ts, before two captures.
      test.setTimeout(flowTimeout);
      const title = "Safe diving practices";
      await writeCourseForm(
        page,
        title,
        "I will dive within the limits of my training and plan every dive with my buddy.",
      );
      await expect(
        page
          .locator("#course-forms")
          .getByText(copy("waiversStaff.courseForms.notice.saved"), { exact: true }),
      ).toBeVisible();
      await clearCourseForms(page, "open-water-diver");
      await requireCourseForm(page, "open-water-diver", title);
      await scheduleCrewedOpenWaterSession(page, "Open Water Diver — review forms", 24);
      await signOut(page);
      const ready = await bookOpenWaterSession(page, "Ines Costa", "ines.forms.review@example.com");
      await page.goto(ready);
      const sign = await openThreadStep(page, "sign");
      await sign.getByRole("link", { name: "Sign course forms" }).click();
      await page.getByRole("heading", { level: 1, name: title }).waitFor();
      await capture(page, "course-form-active", "light");
      await page.getByLabel("Type your full name").fill("Ines Costa");
      await page.getByRole("checkbox", { name: /I have read this form/ }).check();
      await page.getByRole("button", { name: "Sign form" }).click();
      await page.getByText("Course forms signed").waitFor();
      await capture(page, "course-form-signed", "light");
    });

    test("a saved readiness page renders offline and after its cancellation landing", async ({
      page,
      context,
    }) => {
      // Reuses ready-offline.spec.ts's worker-clock fixture. The worker's
      // own Date otherwise sees the real day and discards the frozen copy.
      test.setTimeout(flowTimeout);
      await context.route("**/manifest-sw.js", async (route) => {
        const response = await route.fetch();
        const fixed = `const __fixed = new Date(${JSON.stringify(E2E_FROZEN_CLOCK)}).getTime();
const __RealDate = Date;
globalThis.Date = new Proxy(__RealDate, {
  construct: (target, args) => Reflect.construct(target, args.length === 0 ? [__fixed] : args),
  get: (target, prop, receiver) => prop === "now" ? () => __fixed : Reflect.get(target, prop, receiver),
});\n`;
        await route.fulfill({ response, body: fixed + (await response.text()) });
      });
      const staffTrip = await tripPathByTitle(
        page,
        "blue-mantis",
        "Two-Tank Reef — Molasses & French",
      );
      await signOut(page);
      await page.goto(publicTripUrl(staffTrip), { waitUntil: "domcontentloaded" });
      await bookASeatAndOpenThread(page, "Olive Rivera", "olive.offline.review@example.com");
      const readyPath = new URL(page.url()).pathname;
      await page.goto(readyPath, { waitUntil: "domcontentloaded" });
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await (await caches.open("diveday-ready-page-v1")).keys()).length,
            ),
          { timeout: 30_000 },
        )
        .toBeGreaterThan(0);
      await page
        .getByRole("button", { name: diverCopy("ready.offlineRemove"), exact: true })
        .waitFor();
      await context.setOffline(true);
      try {
        await page.reload();
        await page.getByRole("status").filter({ hasText: "No signal" }).waitFor();
        await capture(page, "ready-saved-offline", "light");
      } finally {
        await context.setOffline(false);
      }
      await page.goto(`${readyPath}?cancelled=1`, { waitUntil: "domcontentloaded" });
      await expect
        .poll(
          () =>
            page.evaluate(
              async () => (await (await caches.open("diveday-ready-page-v1")).keys()).length,
            ),
          { timeout: 30_000 },
        )
        .toBe(0);
      await page.getByRole("heading", { level: 1 }).waitFor();
      await capture(page, "ready-cancelled-offline-copy-cleared", "light");
    });
  });

  test.describe("light mode — isolated team and account security states", () => {
    test.use({
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-review-security",
    });

    test("deleting a teammate renders the durable Undo on Team", async ({ page, privateShop }) => {
      await page.goto(`/shop/${privateShop.slug}/settings/team`);
      await page.getByRole("button", { name: "Disable Sal Moretti" }).click();
      const row = page.locator("li").filter({ hasText: "Sal Moretti" }).filter({ visible: true });
      await row.getByText("Disabled", { exact: true }).waitFor();
      await row.getByRole("button", { name: "Delete Sal Moretti" }).click();
      await page.getByRole("button", { name: "Undo", exact: true }).waitFor();
      await capture(page, "team-deleted-undo", "light");
    });

    // Session times belong to Better Auth's wall clock; enrollment and recovery
    // codes are random secrets. Read them in a real one-off audit, never as
    // unstable CI baselines (the written route exemption is issue #1020).
    if (process.env.VISUAL_EXHAUSTIVE_AUDIT === "1") {
      const captureAudit = capture;
      test("account security renders its two-factor status and current sessions", async ({
        page,
        privateShop,
      }) => {
        await page.goto(`/shop/${privateShop.slug}/settings/security`);
        await page.getByRole("heading", { level: 1, name: "Account security" }).waitFor();
        await page.getByRole("button", { name: "Start setup" }).waitFor();
        await captureAudit(page, "settings-security", "light");
      });
      test("account security renders enrollment, refused code and recovery states for review", async ({
        page,
        privateShop,
      }) => {
        test.setTimeout(flowTimeout);
        await page.goto(`/shop/${privateShop.slug}/settings/security`);
        await page.getByRole("button", { name: "Start setup" }).click();
        await page.getByRole("textbox", { name: "Authenticator code" }).waitFor();
        await captureAudit(page, "settings-security-enrollment", "light");
        const secret = (await page.locator("code").first().innerText()).trim();
        const valid = totpCode(secret, Date.parse(E2E_FROZEN_CLOCK));
        const acceptedCodes = new Set(
          Array.from({ length: TOTP_DRIFT_STEPS * 2 + 1 }, (_, index) =>
            totpCode(
              secret,
              Date.parse(E2E_FROZEN_CLOCK) + (index - TOTP_DRIFT_STEPS) * TOTP_STEP_SECONDS * 1_000,
            ),
          ),
        );
        const invalid = ["000000", "111111", "222222", "333333"].find(
          (code) => !acceptedCodes.has(code),
        );
        if (!invalid) throw new Error("No refused authenticator fixture was found");
        await page.getByRole("textbox", { name: "Authenticator code" }).fill(invalid);
        await page.getByRole("button", { name: "Enable", exact: true }).click();
        await page.getByText(copy("settings.security.notice.codeInvalid")).waitFor();
        await captureAudit(page, "settings-security-code-refused", "light");
        await page.getByRole("textbox", { name: "Authenticator code" }).fill(valid);
        await page.getByRole("button", { name: "Enable", exact: true }).click();
        await page.getByRole("button", { name: "Disable two-factor" }).waitFor();
        await expect(page.locator("code")).toHaveCount(10);
        await page.getByText(copy("settings.security.recoveryHeading"), { exact: true }).waitFor();
        await captureAudit(page, "settings-security-recovery-codes", "light");

        // Dismiss only the temporary recovery reveal. The account, enrolled
        // secret, session and every other cookie remain the actual saved state.
        await page.context().clearCookies({ name: "diveday_totp_recovery_codes" });
        await page.reload();
        await page.getByRole("button", { name: "Disable two-factor" }).waitFor();
        await expect(
          page.getByText(copy("settings.security.recoveryHeading"), { exact: true }),
        ).toHaveCount(0);
        await captureAudit(page, "settings-security-enabled", "light");

        const returnTo = `/shop/${privateShop.slug}/settings/export`;
        await page.goto(stepUpChallengeUrl(privateShop.slug, "export", returnTo));
        await page
          .getByRole("heading", { name: copy("settings.security.stepUpHeading") })
          .waitFor();
        await captureAudit(page, "settings-security-step-up", "light");
        const challenge = page.getByLabel(copy("settings.security.stepUpCodeLabel"));
        await challenge.fill(invalid);
        await page.getByRole("button", { name: copy("settings.security.stepUpVerify") }).click();
        await page.getByText(copy("settings.security.notice.codeInvalid")).waitFor();
        await page
          .getByRole("heading", { name: copy("settings.security.stepUpHeading") })
          .waitFor();
        await captureAudit(page, "settings-security-step-up-refused", "light");
        await challenge.fill(valid);
        await page.getByRole("button", { name: copy("settings.security.stepUpVerify") }).click();
        await expect(page).toHaveURL(returnTo);
        await page.getByRole("link", { name: "Download export", exact: true }).waitFor();
        await captureAudit(page, "settings-security-step-up-completed", "light");
      });
    }
  });
}
