import type { ReactNode } from "react";
import { EditorSection, type EditorSectionRef } from "@/components/editor/EditorSection";
import { controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { CourseSwitches } from "./CourseSwitches";
import type { EditableCourse } from "./course-types";

/** The editor's at-a-glance, who-may-enrol and what-the-fee-covers sections. */
export function CourseDetailSections({
  course,
  glance,
  enroll,
  feeCovers,
  levelAge,
  t,
}: {
  course: EditableCourse;
  glance: EditorSectionRef;
  enroll: EditorSectionRef;
  feeCovers: EditorSectionRef;
  levelAge: string;
  t: StaffTranslator;
}) {
  return (
    <>
      <EditorSection as="fieldset" {...glance}>
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
      </EditorSection>

      <EditorSection
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
      </EditorSection>

      <EditorSection {...feeCovers} as="fieldset">
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
      </EditorSection>
    </>
  );
}
