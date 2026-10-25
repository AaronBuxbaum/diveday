import type { Locator, Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { clearCourseForms } from "./course-form-only";
import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookOpenWaterSession,
  createTrip,
  daysFromNow,
  findTripOnBoard,
  openBoatCheck,
  openIfClosed,
  openRosterDetails,
  openRosterNotes,
  openRosterRow,
  openTripAboutRow,
  openTripActivity,
  openTripTab,
  requireCourseForm,
  scheduleCrewedOpenWaterSession,
  seatFromRoster,
  signInAsOwner,
  signOut,
  tripPathByTitle,
  writeCourseForm,
} from "./helpers";
import type { AuditCapture } from "./visual-audit-capture";

const staff = staffTranslator("en-US");
const REEF = "Two-Tank Reef — Molasses & French";

async function reefRoster(page: Page): Promise<Locator> {
  await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
  await openTripTab(page, "Trip");
  return openRosterRow(page, "Priya Sharma");
}

async function reefManifest(page: Page): Promise<void> {
  await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
  await openTripTab(page, "Manifest");
}

/** The innermost disclosure containing a field, rather than its open roster ancestor. */
function fieldEditor(row: Locator, selector: string): Locator {
  return row.locator(`details:has(${selector})`).last();
}

/** Opened bodies missing from the resting departure and roster captures. */
export function registerDepartureExpandedAuditCaptures(capture: AuditCapture, flowTimeout: number) {
  test.describe("light mode — departure and roster expanded controls", () => {
    signedInAsOwner();
    test.use({ colorScheme: "light", viewport: { width: 1280, height: 800 } });

    test("the buddy team's inner builder exposes its person checkboxes", async ({ page }) => {
      await reefManifest(page);
      const outer = page
        .locator("details")
        .filter({ has: page.locator("#buddy-teams-heading") })
        .first();
      await openIfClosed(outer);
      const builder = outer
        .locator("details")
        .filter({
          has: page.locator("summary", { hasText: staff("manifest.buddyNewTeamHeading") }),
        })
        .last();
      await openIfClosed(builder);
      await expect(builder.getByRole("checkbox").first()).toBeVisible();
      await expect(
        builder.getByRole("button", { name: staff("manifest.buddyFormSubmit"), exact: true }),
      ).toBeVisible();
      await capture(page, "manifest-buddy-checkbox-builder", "light");
    });

    test("adding a dock rider exposes the rider and emergency contact fields", async ({ page }) => {
      await reefManifest(page);
      await openIfClosed(page.locator("#dock-rider"));
      const form = page.getByTestId("dock-rider-form");
      await form.getByLabel(staff("desk.dockRider.name"), { exact: true }).fill("Sam Rider");
      await expect(
        form.getByLabel(staff("desk.dockRider.emergencyName"), { exact: true }),
      ).toBeVisible();
      await expect(form.getByRole("radio")).toHaveCount(2);
      await capture(page, "manifest-dock-rider-editor", "light");
    });

    test("a boat check opens the problem note beside its equipment item", async ({ page }) => {
      await reefManifest(page);
      await openBoatCheck(page);
      // The checklist button names its item and its screen-reader state instruction.
      await expect(
        page.getByRole("button", {
          name: `VHF radio checked ${staff("trips.preDepartureCheck.uncheckedLabel")}`,
          exact: true,
        }),
      ).toBeVisible();
      // One "Note a problem" for the whole list (B07): its picker starts on
      // no line (review fix, dde-a F3), so the note names its item first.
      const editor = page.locator("details").filter({
        has: page.locator("> summary", {
          hasText: staff("trips.preDepartureCheck.noteProblem"),
        }),
      });
      await openIfClosed(editor);
      await editor
        .getByLabel(staff("trips.preDepartureCheck.noteItemLabel"), { exact: true })
        .selectOption({ label: "VHF radio" });
      await editor
        .getByLabel(staff("trips.preDepartureCheck.noteLabel"))
        .fill("VHF crackles on 16");
      await expect(
        editor.getByRole("button", {
          name: staff("trips.preDepartureCheck.noteSave"),
          exact: true,
        }),
      ).toBeVisible();
      await capture(page, "manifest-boat-snag-note-editor", "light");
    });

    test("a crew roll-call row opens the crew-specific person sheet", async ({ page }) => {
      await reefManifest(page);
      const trigger = page.getByRole("button", {
        name: staff("manifest.openPersonDetails", { name: "Keiko Tanaka" }),
        exact: true,
      });
      await expect(trigger).toHaveAttribute("data-hydrated", "true");
      const sheet = page.getByRole("dialog");
      const openSheet = async () => {
        if (!(await sheet.isVisible())) await trigger.click();
        await expect(
          sheet.getByRole("heading", { name: "Keiko Tanaka", exact: true }),
        ).toBeVisible();
        await expect(sheet.getByText(/^Crew ·/)).toBeVisible();
      };
      await openSheet();
      await capture(page, "manifest-crew-person-sheet", "light", { beforeShot: openSheet });
    });

    test("certifying a student exposes the agency award picker", async ({ page }) => {
      await (await findTripOnBoard(page, "blue-mantis", /Advanced Open Water Diver/)).click();
      await openTripTab(page, "Trip");
      const student = page.locator('#roster li[id^="booking-"]').first();
      await openRosterDetails(student);
      const editor = fieldEditor(student, 'select[name="award"]');
      await openIfClosed(editor);
      await expect(editor.getByLabel(staff("trips.roster.certifyLevel"))).toBeVisible();
      await expect(
        editor.getByRole("button", { name: staff("trips.roster.certifyConfirm"), exact: true }),
      ).toBeVisible();
      await capture(page, "roster-course-certify-editor", "light");
    });

    test("a student's next step opens its own note and saved-outcome control", async ({ page }) => {
      await (await findTripOnBoard(page, "blue-mantis", /Advanced Open Water Diver/)).click();
      await openTripTab(page, "Trip");
      const student = await openRosterRow(page, "Naledi Khumalo");
      // Private staff notes also use name="note"; choose the course control by its summary.
      const editor = student.locator(
        `details:has(> summary:text-is(${JSON.stringify(staff("trips.roster.nextStepSummary"))}))`,
      );
      await openIfClosed(editor);
      await editor
        .getByLabel(staff("trips.roster.nextStepLabel"))
        .fill("Book your deep dive with Marcus before the card arrives.");
      await expect(
        editor.getByRole("button", { name: staff("trips.roster.nextStepSave"), exact: true }),
      ).toBeVisible();
      await capture(page, "roster-course-next-step-editor", "light");
    });

    test("a pickup editor exposes the lodging and pickup time together", async ({ page }) => {
      const row = await reefRoster(page);
      const editor = fieldEditor(row, 'input[name="hotelPickupLocation"]');
      await openIfClosed(editor);
      await editor.getByLabel(staff("trips.roster.pickupLocationLabel")).fill("Marina House");
      await editor.getByLabel(staff("trips.roster.pickupTimeLabel")).fill("07:15");
      await expect(
        editor.getByRole("button", { name: staff("trips.roster.savePickup") }),
      ).toBeVisible();
      await capture(page, "roster-pickup-editor", "light");
    });

    test("a lunch note opens its galley field and allergy guidance", async ({ page }) => {
      await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
      const plan = await openTripAboutRow(page, staff("trips.about.plan"));
      await plan.locator('input[name="lunchAboard"]').check();
      await plan
        .getByRole("button", { name: staff("trips.details.saveChanges"), exact: true })
        .click();
      await page.waitForURL(/notice=saved/);
      // Save the real departure configuration before returning to its roster;
      // the lunch editor's presence then proves that setting persisted.
      await openTripTab(page, "Trip");
      const row = await openRosterRow(page, "Priya Sharma");
      const editor = fieldEditor(row, 'input[name="dietaryNote"]');
      await openIfClosed(editor);
      await editor.getByLabel(staff("trips.roster.lunchNoteLabel")).fill("Vegetarian");
      await expect(
        editor.getByText(staff("trips.roster.lunchNoteHint"), { exact: true }),
      ).toBeVisible();
      await capture(page, "roster-lunch-note-editor", "light");
    });

    test("an emergency contact opens its own name and phone editor", async ({ page }) => {
      const row = await reefRoster(page);
      const editor = fieldEditor(row, 'input[name="emergencyContactName"]');
      await openIfClosed(editor);
      await expect(
        editor.getByLabel(staff("trips.roster.emergencyContactNameLabel")),
      ).toBeVisible();
      await expect(
        editor.getByLabel(staff("trips.roster.emergencyContactPhoneLabel")),
      ).toBeVisible();
      await expect(
        editor.getByRole("button", { name: staff("trips.roster.saveEmergencyContact") }),
      ).toBeVisible();
      await capture(page, "roster-emergency-contact-editor", "light");
    });

    test("private roster notes open the staff-only composer", async ({ page }) => {
      const row = await reefRoster(page);
      await openRosterNotes(row);
      const field = row.getByLabel(staff("trips.roster.addNoteLabel"));
      await field.fill("Prefers the aft ladder.\nCheck in before the first dive.");
      await expect(
        row.getByRole("button", { name: staff("trips.roster.addPrivateNote") }),
      ).toBeVisible();
      await capture(page, "roster-private-note-editor", "light");
    });

    test("the departure note opens the message for everyone booked", async ({ page }) => {
      const path = await tripPathByTitle(page, "blue-mantis", REEF);
      await page.goto(`${path}?view=details#departure-note`);
      const field = page.getByTestId("departure-note-body");
      await field.fill("Meet at the shop ten minutes early so we can leave together.");
      await expect(
        page.getByRole("button", { name: staff("desk.departureNote.submit"), exact: true }),
      ).toBeVisible();
      await capture(page, "departure-note-composer", "light");
    });

    test("the departure's work summary opens the individual needs-you links", async ({ page }) => {
      await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
      await openTripTab(page, "Trip");
      const facts = page
        .locator("details")
        .filter({ has: page.locator("summary", { hasText: /^Needs you ·/ }) })
        .first();
      await openIfClosed(facts);
      await expect(
        facts
          .getByRole("link", { name: /^Prep · \d+$|missing a (rental )?size|not asked about kit/i })
          .first(),
      ).toBeVisible();
      await expect(facts.getByRole("link", { name: /awaiting payment/ })).toBeVisible();
      await capture(page, "departure-needs-you-expanded", "light");
    });

    test("departure activity opens the recorded event body", async ({ page }) => {
      await page.goto(await tripPathByTitle(page, "blue-mantis", REEF));
      await openTripActivity(page);
      const activity = page
        .locator("details")
        .filter({
          has: page.locator("summary", { hasText: staff("trips.guests.activityHeading") }),
        })
        .last();
      await expect(activity).toHaveAttribute("open", "");
      await expect(activity.locator(":scope > div")).toBeVisible();
      await expect(activity.locator(":scope > div")).toContainText(/\S/);
      await capture(page, "departure-activity-expanded", "light");
    });

    test("one real enrollment exposes its paper-form and charter training editors", async ({
      page,
    }) => {
      // These two editors share the same enrollment: the course requires the
      // paper form, and the overlapping charter can count toward that course.
      test.setTimeout(flowTimeout);
      const formTitle = "Adventure dive statement";
      await writeCourseForm(
        page,
        formTitle,
        "I will dive within the limits of my training and follow the instructor’s plan.",
      );
      await clearCourseForms(page, "open-water-diver");
      await requireCourseForm(page, "open-water-diver", formTitle);
      const coursePath = await scheduleCrewedOpenWaterSession(
        page,
        "Open Water Diver — review training",
        24,
      );
      await signOut(page);
      await bookOpenWaterSession(page, "Inez Noguera", "inez.training.review@example.com");
      await signInAsOwner(page);
      await page.goto(coursePath);
      const courseSeat = await openRosterRow(page, "Inez Noguera");
      const paper = courseSeat.locator("[data-course-forms-owed] details");
      await openIfClosed(paper);
      await expect(
        paper.getByLabel(staff("trips.roster.courseForms.formLabel"), { exact: true }),
      ).toBeVisible();
      await expect(
        paper.getByLabel(staff("trips.roster.courseForms.signedOn"), { exact: true }),
      ).toBeVisible();
      await expect(paper.getByRole("checkbox")).toBeVisible();
      await capture(page, "roster-paper-course-form-editor", "light");

      const charterTitle = "Training dive — review charter";
      await createTrip(page, {
        title: charterTitle,
        date: daysFromNow(24),
        departsAt: "11:00",
        returnsAt: "14:00",
        capacity: 8,
        price: 120,
      });
      const charterPath = await tripPathByTitle(page, "blue-mantis", charterTitle);
      const charterId = charterPath.split("/").at(-1);
      if (!charterId) throw new Error(`No departure id in ${charterPath}`);
      await seatFromRoster(page, charterId, "Inez Noguera");
      const trainingSeat = await openRosterRow(page, "Inez Noguera");
      const training = trainingSeat.locator("[data-training-mark] details");
      await openIfClosed(training);
      await expect(
        training.getByLabel(staff("trips.roster.trainingMark.countsToward")),
      ).toBeVisible();
      await expect(training.locator("select option")).toContainText(["Open Water Diver"]);
      await expect(
        training.getByRole("button", {
          name: staff("trips.roster.trainingMark.mark"),
          exact: true,
        }),
      ).toBeVisible();
      await capture(page, "roster-training-mark-editor", "light");
    });
  });
}
