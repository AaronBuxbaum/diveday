import type { ReactNode } from "react";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CourseSection, type CourseSectionRef } from "./CourseSection";
import { CourseSwitches } from "./CourseSwitches";
import type { EditableCourse } from "./course-types";

/**
 * The editor's at-a-glance, who-may-enrol and what-the-fee-covers sections,
 * one component each, because the page opens the first and closes the other
 * two (visual review 2026-10-24, A11).
 */
export function CourseGlanceSection({
  course,
  glance,
  t,
}: {
  course: EditableCourse;
  glance: CourseSectionRef;
  t: StaffTranslator;
}) {
  return (
    <CourseSection as="fieldset" {...glance}>
      <FieldGrid columns={2} className="gap-y-5">
        <Field label={t("courses.edit.durationLabel")}>
          <input
            id="durationText"
            name="durationText"
            maxLength={120}
            defaultValue={course.durationText ?? ""}
            placeholder={t("courses.edit.durationPlaceholder")}
            className={controlClass}
          />
        </Field>
        <Field label={t("courses.edit.groupSizeLabel")}>
          <input
            id="groupSizeText"
            name="groupSizeText"
            maxLength={120}
            defaultValue={course.groupSizeText ?? ""}
            placeholder={t("courses.edit.groupSizePlaceholder")}
            className={controlClass}
          />
        </Field>
      </FieldGrid>
      {/* Filed with how the course *runs* rather than with who may take
            it: the shop's own calls about its own gas and its own gear, not
            agency admission rules like the facts in the next section. */}
      <CourseSwitches course={course} t={t} />
    </CourseSection>
  );
}

export function CourseEnrollSection({
  course,
  enroll,
  levelAge,
  t,
}: {
  course: EditableCourse;
  enroll: CourseSectionRef;
  levelAge: string;
  t: StaffTranslator;
}) {
  return (
    <CourseSection
      as="fieldset"
      {...enroll}
      description={t.rich("courses.edit.enrollDescription", {
        levelAge,
        strong: (chunks: ReactNode) => (
          <strong className="font-medium text-foreground">{chunks}</strong>
        ),
      })}
    >
      {/* No "this is a taster session" tick box. Which courses are
                tasters is not something a shop tells DiveDay — DiveDay ships
                the catalogue and already knows (`isIntroCourse` on the
                published templates, src/content/course-templates.ts): Discover
                Scuba and Try Scuba are, and an Advanced Open Water is not.
                Worse, it was a safety control wearing a checkbox: the flag
                picks the tighter 2:1 in-water ratio (src/lib/course-ratios.ts,
                HD-6), so the box existed only to let someone quietly turn that
                cap off on a course full of people who have never breathed
                underwater. The column stays; the way to set it is to be one of
                those courses. */}
      <FieldGrid columns={1} className="gap-y-5">
        <Field label={t("courses.edit.prerequisiteLabel")}>
          <textarea
            id="prerequisiteNote"
            name="prerequisiteNote"
            rows={4}
            maxLength={400}
            defaultValue={course.prerequisiteNote ?? ""}
            placeholder={t("courses.edit.prerequisitePlaceholder")}
            className={textareaClassFor(4)}
          />
        </Field>
      </FieldGrid>
    </CourseSection>
  );
}

export function CourseFeeCoversSection({
  course,
  feeCovers,
  t,
}: {
  course: EditableCourse;
  feeCovers: CourseSectionRef;
  t: StaffTranslator;
}) {
  return (
    <CourseSection {...feeCovers} as="fieldset">
      <FieldGrid columns={2} className="gap-y-5">
        <Field
          label={t("courses.edit.includedLabel")}
          description={t("courses.edit.oneItemPerLine")}
        >
          <textarea
            id="includes"
            name="includes"
            rows={6}
            maxLength={2000}
            defaultValue={course.includes.join("\n")}
            placeholder={t("courses.edit.includedPlaceholder")}
            className={textareaClassFor(6)}
          />
        </Field>
        <Field
          label={t("courses.edit.notIncludedLabel")}
          description={t("courses.edit.oneItemPerLine")}
        >
          <textarea
            id="excludes"
            name="excludes"
            rows={6}
            maxLength={2000}
            defaultValue={course.excludes.join("\n")}
            placeholder={t("courses.edit.notIncludedPlaceholder")}
            className={textareaClassFor(6)}
          />
        </Field>
      </FieldGrid>
    </CourseSection>
  );
}
