import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { clearCourseForms } from "./course-form-only";
import { expect } from "./fixtures";
import {
  bookOpenWaterSession,
  e2eNow,
  requireCourseForm,
  rosterRow,
  scheduleCrewedOpenWaterSession,
  signInAsOwner,
  signOut,
  writeCourseForm,
} from "./helpers";

/** Real enrollment and a single visible QR; the returned ready path stays in memory. */
export async function openCourseFormQr(page: Page, options: { clock?: boolean } = {}) {
  const title = "Safe diving practices";
  await writeCourseForm(
    page,
    title,
    "I will follow the instructor's plan for every in-water session.",
  );
  await clearCourseForms(page, "open-water-diver");
  await requireCourseForm(page, "open-water-diver", title);
  const tripPath = await scheduleCrewedOpenWaterSession(
    page,
    `QR course ${e2eNow().getTime()}`,
    24,
  );
  await signOut(page);
  const student = `Ines ${e2eNow().getTime()}`;
  const readyPath = await bookOpenWaterSession(
    page,
    student,
    `ines-${e2eNow().getTime()}@example.com`,
  );
  await signInAsOwner(page);
  await page.goto(tripPath);
  const row = rosterRow(page, student);
  await expect(row.locator("[data-course-forms-owed]")).toHaveCount(1);
  const t = staffTranslator("en-US");
  if (options.clock) await page.clock.install();
  await row
    .getByRole("button", { name: t("trips.roster.courseForms.showQrFor", { name: student }) })
    .click();
  const dialog = page.getByRole("dialog", { name: t("trips.roster.courseForms.qrTitle") });
  await expect(dialog.getByRole("img")).toBeVisible();
  return { student, title, readyPath, row, dialog, t };
}
