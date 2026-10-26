import { expect, signedInAsOwner, test } from "./fixtures";
import { daysFromNow } from "./helpers";
import type { AuditCapture } from "./visual-audit-capture";

/** Open controls whose resting pages already have their own captures. */
export function registerGearStaffOverlayAuditCaptures(capture: AuditCapture) {
  test.describe("light mode — gear record editors and overlays", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the pull-for-service dialog renders the unit's own reason field", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear");
      await page.getByRole("link", { name: "BCD #6", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "BCD #6" }).waitFor();
      await page.getByRole("button", { name: "Pull for service" }).click();
      const dialog = page.getByRole("dialog", { name: "Pull for service" });
      await dialog.getByLabel("Why it’s coming off the wall").fill("Dump valve leaks");
      await capture(page, "gear-pull-for-service-dialog", "light");
    });

    test("the unit's service log opens its date and clock fields together", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear");
      await page.getByRole("link", { name: "Reg #1", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Reg #1" }).waitFor();
      const service = page.getByRole("region", { name: "Service", exact: true });
      await service.locator("summary").filter({ hasText: "Log a service" }).click();
      await service.getByLabel("Note").waitFor();
      await capture(page, "gear-log-service-editor", "light");
    });

    test("the unit's service history renders a saved bench entry", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear");
      await page.getByRole("link", { name: "Reg #1", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Reg #1" }).waitFor();
      const service = page.getByRole("region", { name: "Service", exact: true });
      await service.locator("summary").filter({ hasText: "Log a service" }).click();
      await service.getByLabel("Note").fill("Second stage rebuilt on the bench");
      await service.getByRole("button", { name: "Log it" }).click();
      await expect(page.getByRole("status").filter({ hasText: "Logged" })).toBeVisible();
      await expect(page.getByRole("status").filter({ hasText: "Logged" })).toBeHidden();
      await service.locator("summary").filter({ hasText: "History" }).click();
      await service.getByText("Second stage rebuilt on the bench", { exact: true }).waitFor();
      await capture(page, "gear-service-history-open", "light");
    });

    test("the unit's notes editor opens beside the existing record", async ({ page }) => {
      await page.goto("/shop/blue-mantis/gear");
      await page.getByRole("link", { name: "Reg #1", exact: true }).click();
      await page.getByRole("heading", { level: 1, name: "Reg #1" }).waitFor();
      const notes = page
        .locator("details")
        .filter({ has: page.locator("summary").filter({ hasText: "Add a note" }) });
      await notes.locator("summary").filter({ hasText: "Add a note" }).click();
      await notes.getByLabel("Add a note").fill("Mouthpiece needs replacing");
      await capture(page, "gear-add-note-editor", "light");
    });
  });

  test.describe("light mode — staffing shift editors", () => {
    test.use({
      colorScheme: "light",
      viewport: { width: 1280, height: 800 },
      privateShopSlug: "reef-review-shifts",
    });

    test("adding a shift and opening its Remove action render in their own day", async ({
      page,
      privateShop,
    }) => {
      await page.goto(`/shop/${privateShop.slug}/staffing`);
      await page.getByRole("heading", { level: 1, name: "Schedule" }).waitFor();
      const form = page.locator("#add-shift");
      await form.locator("> summary").click();
      await form.getByLabel("Staff member").selectOption({ label: "Keiko Tanaka" });
      await form.getByLabel("Date").fill(daysFromNow(2));
      await form.getByLabel("Starts").fill("06:30");
      await form.getByLabel("Ends").fill("14:45");
      await form.getByLabel("Note").fill("Boat 2");
      await capture(page, "staffing-add-shift-editor", "light");
      await form.getByRole("button", { name: "Add shift" }).click();
      await expect(page.getByText("Shift saved")).toBeVisible();
      // The toast leaves on a real 4-second timer: whether the first width
      // caught it depended on how long the capture took (two one-worker runs
      // of one tree disagreed at vw-390). The shift is the subject.
      await expect(page.getByText("Shift saved")).toBeHidden();
      const week = page.getByRole("region", { name: "Who’s working" });
      await week.getByText("Boat 2", { exact: true }).first().waitFor();
      await capture(page, "staffing-shift-remove-disclosure", "light", {
        // The grid has a disclosure; the phone day-list keeps Remove in the
        // shift's own "⋯" (visual review A40). Locate the shift in the
        // visible layout after each resize.
        beforeShot: async () => {
          const shift = week
            .locator("details, li")
            .filter({ hasText: "Boat 2" })
            .filter({ visible: true });
          await expect(shift).toHaveCount(1);
          const summary = shift.locator("> summary");
          if ((await summary.count()) > 0) {
            if (!(await shift.evaluate((element) => element.hasAttribute("open")))) {
              await summary.click();
            }
          } else {
            const menu = shift.getByRole("button", { name: /^Shift for Keiko Tanaka on / });
            if ((await menu.getAttribute("aria-expanded")) !== "true") await menu.click();
          }
          await expect(shift.getByRole("button", { name: "Remove", exact: true })).toBeVisible();
        },
      });
    });
  });

  test.describe("light mode — public language chooser", () => {
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the public header's language picker shows the current language and alternatives", async ({
      page,
    }) => {
      await page.goto("/s/blue-mantis");
      const header = page.getByRole("banner");
      await header.getByRole("button", { name: "Change language" }).click();
      await expect(header.getByRole("button", { name: "English", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await header.getByRole("button", { name: "Español", exact: true }).waitFor();
      await capture(page, "public-language-picker-open", "light");
    });
  });
}
