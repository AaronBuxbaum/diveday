// @vitest-environment jsdom
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import type { CourseFormSummary } from "@/db/course-forms";
import { staffTranslator } from "@/i18n/staff-messages";
import { CourseFormsRequirement } from "./CourseFormsRequirement";

afterEach(cleanup);
const t = staffTranslator("en-US");
const form = (id: string, medicalScreening: boolean): CourseFormSummary => ({
  id,
  title: medicalScreening
    ? "Diver Medical Participant Questionnaire"
    : "Youth Diver Statement of Understanding and Release of Liability",
  body: "Full legal wording remains unchanged.",
  version: 1,
  versionId: `${id}-v1`,
  updatedAt: new Date("2026-10-01T00:00:00Z"),
  medicalScreening,
});

describe("required course form metadata", () => {
  it("shows complete titles and visible order labels, with age absent for a medical form", () => {
    const forms = [form("youth", false), form("medical", true)];
    render(
      <CourseFormsRequirement
        id="forms"
        label="Required forms"
        forms={forms}
        required={["youth", "medical"]}
        notice={undefined}
        waiversPath="/shop/test/waivers"
        canWriteForms
        addImpact={{ students: 0, sessions: 0 }}
        t={t}
      />,
    );
    for (const entry of forms)
      expect(screen.getByRole("checkbox", { name: entry.title })).toBeVisible();
    expect(screen.getAllByText(t("courses.edit.forms.displayOrder"))).toHaveLength(2);
    expect(
      screen.getByRole("spinbutton", {
        name: t("courses.edit.forms.maxAgeAria", { form: forms[0].title }),
      }),
    ).toBeVisible();
    expect(
      screen.queryByRole("spinbutton", {
        name: t("courses.edit.forms.maxAgeAria", { form: forms[1].title }),
      }),
    ).toBeNull();
  });
});
