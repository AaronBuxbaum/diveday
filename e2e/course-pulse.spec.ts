import type { Page } from "@playwright/test";
import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { openTripTab, tripPathByTitle } from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");

async function openCourseDeparture(page: Page) {
  const path = await tripPathByTitle(page, "blue-mantis", /Advanced Open Water Diver/, {
    daysOut: 29,
  });
  await page.goto(path);
  await openTripTab(page, "Trip");
  await expect(page.getByRole("heading", { name: t("trips.coursePulse.heading") })).toBeVisible();
  const note = page.getByRole("textbox", { name: t("trips.coursePulse.noteLabel") });
  return { path, note };
}

test("an instructor edits a private course departure note without losing a stale draft", async ({
  page,
  browser,
  workerBaseURL,
  staffStorageState,
}) => {
  const { path, note } = await openCourseDeparture(page);
  await note.fill("Focus on buoyancy before navigation.");
  await page.getByRole("button", { name: t("trips.coursePulse.save"), exact: true }).click();
  await expect(page.getByText(t("trips.coursePulse.saved"), { exact: true })).toBeVisible();
  const staleContext = await browser.newContext({
    baseURL: workerBaseURL,
    storageState: await staffStorageState("owner"),
  });
  const stale = makeActivitySafe(await staleContext.newPage());
  await stale.goto(path);
  await openTripTab(stale, "Trip");
  await note.fill("Practice compass headings before the next dive.");
  await page.getByRole("button", { name: t("trips.coursePulse.save"), exact: true }).click();
  await expect(page.locator('input[name="expectedNote"]')).toHaveValue(
    "Practice compass headings before the next dive.",
  );
  await stale
    .getByRole("textbox", { name: t("trips.coursePulse.noteLabel") })
    .fill("My teaching plan is retained.");
  await stale.getByRole("button", { name: t("trips.coursePulse.save"), exact: true }).click();
  await expect(
    stale.getByText(t("trips.coursePulse.errors.changed"), { exact: true }),
  ).toBeVisible();
  await expect(stale.getByRole("textbox", { name: t("trips.coursePulse.noteLabel") })).toHaveValue(
    "My teaching plan is retained.",
  );
  await staleContext.close();
});

// The stale-tab workflow and the reversible deletion each keep the ordinary CI budget.
// Combining both journeys, their schedule lookups and reloads exceeded 15 seconds.
test("a private teaching note can be deleted, restored and deleted again", async ({ page }) => {
  const { note } = await openCourseDeparture(page);
  await note.fill("Practice compass headings before the next dive.");
  await page.getByRole("button", { name: t("trips.coursePulse.save"), exact: true }).click();
  await expect(page.locator('input[name="expectedNote"]')).toHaveValue(
    "Practice compass headings before the next dive.",
  );
  await page.getByRole("button", { name: t("trips.coursePulse.delete"), exact: true }).click();
  await expect(page.getByText(t("trips.coursePulse.deleted"), { exact: true })).toBeVisible();
  await expect(note).toHaveValue("");
  await page.getByRole("button", { name: t("shared.undoToast.undo"), exact: true }).click();
  await expect(note).toHaveValue("Practice compass headings before the next dive.");
  await page.reload();
  await expect(note).toHaveValue("Practice compass headings before the next dive.");
  await page.getByRole("button", { name: t("trips.coursePulse.delete"), exact: true }).click();
  await expect(
    page.getByRole("button", { name: t("shared.undoToast.undo"), exact: true }),
  ).toBeVisible();
  await page.reload();
  await expect(note).toHaveValue("");
});

// story: OWN-09
test("course preparation follow-up is owned on the student row and can be released", async ({
  page,
}) => {
  await openCourseDeparture(page);
  const section = page.locator('section[aria-labelledby="course-preparation"]');
  const initialRow = section
    .getByRole("listitem")
    .filter({ has: page.getByRole("button", { name: /Take follow-up for /, exact: true }) })
    .first();
  const href = await initialRow.getByRole("link").getAttribute("href");
  const row = section.getByRole("listitem").filter({ has: page.locator(`a[href="${href}"]`) });
  const gaps = await row.locator("span.text-muted").first().innerText();
  await row.getByRole("button", { name: /Take follow-up for /, exact: true }).click();
  await expect(
    row.getByText(t("trips.coursePulse.followup.inProgress"), { exact: false }),
  ).toBeVisible();
  await expect(row.locator("span.text-muted").first()).toHaveText(gaps);
  await row.getByRole("button", { name: /Release follow-up for /, exact: true }).click();
  await expect(row.getByRole("button", { name: /Take follow-up for /, exact: true })).toBeVisible();
});
