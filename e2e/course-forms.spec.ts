import { staffTranslator } from "../src/i18n/staff-messages";
import { clearCourseForms } from "./course-form-only";
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

const staffCopy = staffTranslator("en-US");

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
    await expect(
      page
        .locator("#course-forms")
        .getByText(staffCopy("waiversStaff.courseForms.notice.saved"), { exact: true }),
    ).toBeVisible();
    await clearCourseForms(page, "open-water-diver");
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
    await expect(page.getByText("Course forms signed")).toBeVisible();

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

test.describe("course-form disclosure anchors", () => {
  signedInAsOwner();

  test("native and repeated client entries reveal the definitions, including a refused form", async ({
    page,
  }) => {
    const path = "/shop/blue-mantis/waivers#course-form-new";
    const parent = page.locator("details#course-forms").filter({ visible: true });
    const form = page.locator("details#course-form-new").filter({ visible: true });
    await page.goto(path);
    await expect(parent).toHaveAttribute("open", "");
    await expect(form).toHaveAttribute("open", "");
    const clientGo = async (url: string) => {
      const arrived = page.waitForURL(
        (candidate) => `${candidate.pathname}${candidate.hash}` === url,
      );
      await page.evaluate((destination) => {
        const router = (
          window as unknown as { next?: { router?: { push: (url: string) => void } } }
        ).next?.router;
        if (!router) throw new Error("installed Next App Router debugger facade unavailable");
        router.push(destination);
      }, url);
      await arrived;
    };
    for (let index = 0; index < 2; index++) {
      await parent.locator(":scope > summary").click();
      await expect(parent).not.toHaveAttribute("open", "");
      await clientGo("/shop/blue-mantis/courses/open-water-diver/edit");
      await clientGo(path);
      await expect(parent).toHaveAttribute("open", "");
      await expect(form).toHaveAttribute("open", "");
    }
    await page.locator("#course-form-title-new").fill("A form awaiting full wording");
    await page.locator("#course-form-body-new").fill("Short");
    // Exercise the server's refusal as a crafted client can; ordinary native
    // minlength still prevents this submission without that deliberate override.
    await form.locator("form").evaluate((node) => {
      if (!(node instanceof HTMLFormElement)) throw new Error("course form is not a form");
      node.noValidate = true;
    });
    const refused = page.waitForURL(/notice=course-form-invalid/);
    await form.getByRole("button", { name: "Add form", exact: true }).click();
    await refused;
    await expect(parent).toHaveAttribute("open", "");
    await expect(form).toHaveAttribute("open", "");
    await expect(
      form.getByText(staffCopy("waiversStaff.courseForms.notice.invalid"), { exact: true }),
    ).toBeVisible();
  });
});
