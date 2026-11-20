import { Field, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { MAX_ELEARNING_CODES_PER_PASTE } from "@/lib/course-codes";
import { CourseSection, type CourseSectionRef } from "./CourseSection";

/**
 * The editor's "eLearning codes" section (ADR 20261120-course-elearning-codes): paste what the
 * shop bought from its agency, see how many are left. Part of the editor's one Save, and the box
 * is always empty on arrival: a stored code is never drawn back into a page, only counted.
 */
export function ElearningCodesSection({
  section,
  counts,
  t,
}: {
  section: CourseSectionRef;
  counts: { left: number; handedOut: number };
  t: StaffTranslator;
}) {
  return (
    <CourseSection
      {...section}
      as="fieldset"
      description={t("courses.edit.codesDescription", counts)}
    >
      <Field
        hint={t("courses.edit.optionalHint")}
        label={t("courses.edit.codesLabel")}
        description={t("courses.edit.codesFieldHint", { max: MAX_ELEARNING_CODES_PER_PASTE })}
      >
        <textarea
          id="newElearningCodes"
          name="newElearningCodes"
          rows={6}
          maxLength={20_000}
          autoComplete="off"
          spellCheck={false}
          className={`${textareaClassFor(6)} font-mono`}
        />
      </Field>
    </CourseSection>
  );
}
