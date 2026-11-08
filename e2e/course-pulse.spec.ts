import { staffTranslator } from "../src/i18n/staff-messages";
import { expect, makeActivitySafe, signedInAsOwner, test } from "./fixtures";
import { openTripTab, tripPathByTitle } from "./helpers";

signedInAsOwner();
const t = staffTranslator("en-US");

test("an instructor edits a private course departure note without losing a stale draft", async ({
  page,
  browser,
  workerBaseURL,
  staffStorageState,
}) => {
  const path = await tripPathByTitle(page, "blue-mantis", /Advanced Open Water Diver/, {
    daysOut: 29,
  });
  await page.goto(path);
  await openTripTab(page, "Trip");
  await expect(page.getByRole("heading", { name: t("trips.coursePulse.heading") })).toBeVisible();
  const note = page.getByRole("textbox", { name: t("trips.coursePulse.noteLabel") });
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
  await page.getByRole("button", { name: t("trips.coursePulse.delete"), exact: true }).click();
  await expect(page.getByText(t("trips.coursePulse.deleted"), { exact: true })).toBeVisible();
  await expect(note).toHaveValue("");
  await page.reload();
  await expect(note).toHaveValue("");
});
