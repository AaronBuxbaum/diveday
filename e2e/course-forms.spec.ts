import { expect, signedInAsOwner, test } from "./fixtures";
import {
  bookOpenWaterSession,
  e2eNow,
  openThreadStep,
  requireCourseForm,
  rosterRow,
  scheduleCrewedOpenWaterSession,
  signInAsOwner,
  signOut,
  writeCourseForm,
} from "./helpers";

/**
 * **Course forms, end to end** (ADR 20261008-course-forms).
 *
 * The whole loop a shop runs: write a form beside the release, choose it on a
 * course's page, and watch a student who booked a session owe it on the
 * roster until they sign it from their own prep link. The form and the
 * requirement are blue-mantis rows that `/api/test/reset` deletes before every
 * test, so nothing here outlives it.
 */
test.describe("course forms", () => {
  signedInAsOwner();

  test("a form written beside the release and chosen for a course is owed on the roster until the student signs it", async ({
    page,
  }) => {
    // Three staff surfaces, a public booking, and two sign-outs and back:
    // aggregate navigation cost across a long journey, not a hang.
    test.setTimeout(60_000);
    const formTitle = "Safe diving practices";

    // 1. Author, then require.
    await writeCourseForm(
      page,
      formTitle,
      "I will dive within the limits of my training, plan every dive with my buddy, and tell the instructor about anything that changes my fitness to dive.",
    );
    await expect(page.locator("#course-forms").getByText("Saved.")).toBeVisible();
    await requireCourseForm(page, "open-water-diver", formTitle);
    // 24 days out, clear of the seeded sessions whose crew would clash with
    // Marcus Webb's assignment (the same day courses.spec.ts books on).
    const tripPath = await scheduleCrewedOpenWaterSession(
      page,
      `Open Water Diver — forms ${e2eNow().getTime()}`,
      24,
    );
    await signOut(page);

    // 2. A student books the session and lands on their prep link.
    const student = `Ines ${e2eNow().getTime()}`;
    const readyPath = await bookOpenWaterSession(
      page,
      student,
      `ines-${e2eNow().getTime()}@example.com`,
    );

    // 3. The roster names the form the student owes.
    await signInAsOwner(page);
    await page.goto(tripPath);
    await expect(rosterRow(page, student).locator("[data-course-forms-owed]")).toHaveCount(1);
    await expect(
      rosterRow(page, student).getByText(`Course form not signed: ${formTitle}.`),
    ).toBeVisible();
    await signOut(page);

    // 4. The student signs it on the prep link's own forms page.
    await page.goto(readyPath);
    const sign = await openThreadStep(page, "sign");
    await sign.getByRole("link", { name: "Sign course forms" }).click();
    await expect(page.getByRole("heading", { level: 1, name: formTitle })).toBeVisible();
    await page.getByLabel("Type your full name").fill(student);
    await page.getByRole("checkbox", { name: /I have read this form/ }).check();
    await page.getByRole("button", { name: "Sign form" }).click();
    await expect(page.getByText("Course forms signed.")).toBeVisible();

    // 5. The roster clears.
    await signInAsOwner(page);
    await page.goto(tripPath);
    await expect(rosterRow(page, student)).toHaveCount(1);
    await expect(rosterRow(page, student).locator("[data-course-forms-owed]")).toHaveCount(0);
    await expect(
      rosterRow(page, student).getByText(`Course form not signed: ${formTitle}.`),
    ).toHaveCount(0);
  });
});
