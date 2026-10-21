import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { signedInAsOwner, test } from "./fixtures";
import { openCantFillASize, openDiverFileGroup, openIfClosed } from "./helpers";
import type { AuditCapture } from "./visual-audit-capture";

const copy = staffTranslator("en-US");

async function openRecord(page: Page, name = "Priya Sharma") {
  await page.goto(`/shop/blue-mantis/divers?q=${encodeURIComponent(name)}`);
  await page.getByRole("link", { name, exact: true }).click();
  await page.getByRole("heading", { level: 1, name, exact: true }).waitFor();
}

/** The inner file bodies, rather than another picture of their closed doors. */
export function registerDiverExpandedAuditCaptures(capture: AuditCapture) {
  test.describe("light mode — expanded diver files", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the diver's activity opens its real trail and pager", async ({ page }) => {
      await openRecord(page);
      const activity = await openDiverFileGroup(page, copy("divers.activity.heading"));
      await activity.getByRole("listitem").first().waitFor();
      await activity.getByRole("link", { name: "Next", exact: true }).waitFor();
      await capture(page, "diver-activity-open", "light");
    });

    test("the diver's second activity page keeps its trail open", async ({ page }) => {
      await openRecord(page);
      const activity = await openDiverFileGroup(page, copy("divers.activity.heading"));
      await activity.getByRole("link", { name: "Next", exact: true }).click();
      await page.waitForURL(/activity=2/);
      await activity.getByRole("listitem").first().waitFor();
      await activity.getByRole("link", { name: "Previous", exact: true }).waitFor();
      await capture(page, "diver-activity-page-two", "light");
    });

    test("the diver's older story opens the paid booking history", async ({ page }) => {
      // Winnie's eleven seeded bookings extend beyond the ten-row preview.
      await openRecord(page, "Winnie Achebe");
      const story = page.getByRole("region", { name: copy("divers.story.heading"), exact: true });
      const older = story.locator("details").first();
      await openIfClosed(older);
      await older.getByRole("listitem").first().waitFor();
      await capture(page, "diver-story-older-open", "light");
    });

    test("the record's booking picker shows a selected departure beside Book", async ({ page }) => {
      await openRecord(page);
      await page.locator("#book-departure").click();
      const departure = page.getByLabel(copy("divers.bookActivity.courseOrDiveLabel"), {
        exact: true,
      });
      const value = await departure
        .locator('option[value]:not([value=""])')
        .first()
        .getAttribute("value");
      if (!value) throw new Error("The seeded diver has no bookable departure to display");
      await departure.selectOption(value);
      await page
        .getByRole("button", { name: copy("divers.bookActivity.bookActivityButton"), exact: true })
        .waitFor();
      await capture(page, "diver-booking-picker-open", "light");
    });

    test("the add-certification form opens its grouped card picker and number field", async ({
      page,
    }) => {
      await openRecord(page);
      await openDiverFileGroup(page, copy("divers.certifications.heading"));
      const add = page.locator("#card-add");
      await openIfClosed(add);
      await add.locator('select[name="agency"]').selectOption("padi");
      await add.locator('select[name="card"]').selectOption("level:advanced_open_water");
      await add
        .getByLabel(copy("divers.certifications.cardNumber"), { exact: true })
        .fill("DEMO-AOW-4471");
      await capture(page, "diver-add-certification-open", "light");
    });

    test("the self-declared level opens the agency, rung and number sighting fields", async ({
      page,
    }) => {
      await openRecord(page, "Rowan Feld");
      const group = await openDiverFileGroup(page, copy("divers.certifications.heading"));
      const level = group.locator("li").filter({ has: page.locator("#card-awaiting") });
      await level.getByText(copy("divers.certifications.sightCard"), { exact: true }).click();
      await level
        .getByLabel(copy("divers.certifications.sightCardLevel"), { exact: true })
        .waitFor();
      await level.locator('input[name="sightedIdentifier"]').fill("DEMO-ROWAN-4471");
      await capture(page, "diver-level-card-sighting-open", "light");
    });

    test("the self-declared nitrox card opens its distinct evidence guidance", async ({ page }) => {
      await openRecord(page, "Rowan Feld");
      const group = await openDiverFileGroup(page, copy("divers.certifications.heading"));
      const nitrox = group.locator("li").filter({
        has: page.locator('input[name="cardType"][value="nitrox"]'),
      });
      await nitrox.getByText(copy("divers.certifications.sightCard"), { exact: true }).click();
      await nitrox
        .getByText(copy("divers.certifications.sightNitroxCardHint"), { exact: true })
        .waitFor();
      await nitrox.locator('input[name="sightedIdentifier"]').fill("DEMO-NITROX-4471");
      await capture(page, "diver-nitrox-card-sighting-open", "light");
    });

    test("the rental-fit editor opens its size and equipment choices", async ({ page }) => {
      await openRecord(page);
      const gear = await openDiverFileGroup(page, copy("divers.file.gearHeading"));
      await gear.getByText("Edit", { exact: true }).click();
      await gear.getByLabel("BCD size", { exact: true }).waitFor();
      await gear.getByRole("button", { name: "Save rental fit", exact: true }).waitFor();
      await capture(page, "diver-rental-fit-editor-open", "light");
    });

    test("a gear-fit concern opens the staff-fit note without submitting it", async ({ page }) => {
      await openRecord(page);
      await openCantFillASize(page);
      const note = page.locator('input[name="needsStaffFitNote"]');
      await note.fill("Needs a short small BCD from the spare rack");
      await capture(page, "diver-rental-fit-flag-editor", "light");
    });

    test("the diver's private note composer opens inside the file", async ({ page }) => {
      await openRecord(page);
      const notes = await openDiverFileGroup(page, copy("divers.notes.heading"));
      await notes
        .getByLabel(copy("divers.notes.addLabel"), { exact: true })
        .fill("Prefers a slow descent and a briefing at the dock");
      await notes.getByRole("button", { name: copy("divers.notes.add"), exact: true }).waitFor();
      await capture(page, "diver-notes-editor-open", "light");
    });

    test("the diver's delete disclosure exposes its confirmation without deleting", async ({
      page,
    }) => {
      await openRecord(page);
      const remove = page.locator("#remove");
      await openIfClosed(remove.locator("details"));
      await remove
        .getByRole("button", { name: copy("divers.remove.removeDiver"), exact: true })
        .waitFor();
      await capture(page, "diver-delete-confirmation-open", "light");
    });

    test("the guardian-email erasure disclosure asks for the address without erasing it", async ({
      page,
    }) => {
      // Lena's seeded release is already co-signed. Opening its owner-only
      // form is read-only, so no new guardian capability or signature is minted.
      await openRecord(page, "Lena Fischer");
      const guardian = page.locator('section[aria-labelledby="guardian-email-heading"]');
      await openIfClosed(guardian.locator("details").first());
      const confirmation = guardian.locator('input[name="confirmEmail"]').first();
      const email = await confirmation.getAttribute("placeholder");
      if (!email) throw new Error("The guardian's erasure confirmation has no address");
      await confirmation.fill(email);
      await guardian
        .getByRole("button", { name: copy("divers.guardianEmail.erase"), exact: true })
        .waitFor();
      await capture(page, "diver-guardian-email-erasure-open", "light");
    });
  });
}
