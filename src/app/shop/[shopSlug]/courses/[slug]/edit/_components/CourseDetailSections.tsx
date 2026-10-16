import type { ReactNode } from "react";
import { EditorSection, type EditorSectionRef } from "@/components/editor/EditorSection";
import { ChoiceRow, controlClass, Field, FieldGrid, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
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
                it: this answers "do we teach this one on enriched air", which
                is the shop's own call about its own gas, not an agency
                admission rule like the facts in the next section. Unticked, no
                session of this course offers the nitrox box at all — on the
                booking page or on the pre-trip form — however much nitrox the
                shop fills (`nitroxAvailableOn`, src/lib/rentals.ts). */}
        {/* One item in the section's `gap-5` column, with no margin
                      of its own: `mt-5` added to the gap stood it 40px under
                      Duration, where fields sit 20px apart. Its hint is the
                      next line of its own words, at a `Field` description's
                      12px: as a paragraph under the row it hung a 44px
                      target's height under the box, and at 14px (K-414). The
                      box is named by its label alone and described by the
                      hint, as a `Field`'s control is. */}
        <ChoiceRow
          type="checkbox"
          name="nitroxCompatible"
          value="true"
          defaultChecked={course.nitroxCompatible}
          aria-labelledby="nitroxCompatible-label"
          aria-describedby="nitroxCompatible-hint"
          className="text-sm"
        >
          <span id="nitroxCompatible-label" className="block">
            {t("courses.edit.nitroxCompatibleLabel")}
          </span>
          <span id="nitroxCompatible-hint" className="block text-xs text-muted">
            {t("courses.edit.nitroxCompatibleHint")}
          </span>
        </ChoiceRow>
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
