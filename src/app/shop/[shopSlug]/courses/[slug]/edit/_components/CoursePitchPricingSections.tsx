import type { ReactNode } from "react";
import { forgivingCopy } from "@/components/ui/forgiving-copy";
import { controlClass, Field, FieldGrid, PriceField, textareaClassFor } from "@/components/ui/form";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { ShopCurrency } from "@/lib/money";
import { CourseSection, type CourseSectionRef } from "./CourseSection";
import type { EditableCourse } from "./course-types";

/** The editor's pitch and pricing sections. */
export function CoursePitchPricingSections({
  course,
  pitch,
  pricing,
  currency,
  locale,
  t,
  summaryAssist,
  summaryTranslation,
}: {
  course: EditableCourse;
  pitch: CourseSectionRef;
  pricing: CourseSectionRef;
  currency: ShopCurrency;
  locale: string;
  t: StaffTranslator;
  /** Claude's Draft button for the summary, inside the save form; absent while dark. */
  summaryAssist?: ReactNode;
  summaryTranslation?: ReactNode;
}) {
  return (
    <>
      <CourseSection {...pitch} as="fieldset" lead>
        <FieldGrid columns={1} className="gap-y-5">
          <Field
            label={t("courses.edit.subheadLabel")}
            description={t("courses.edit.subheadDescription")}
          >
            <input
              id="summary"
              name="summary"
              maxLength={200}
              defaultValue={course.summary ?? ""}
              className={controlClass}
            />
            {summaryAssist ? <div className="mt-2">{summaryAssist}</div> : null}
          </Field>
          {summaryTranslation}
          <Field
            label={t("courses.edit.overviewLabel")}
            description={t("courses.edit.overviewDescription")}
          >
            <textarea
              id="overview"
              name="overview"
              rows={8}
              maxLength={6000}
              defaultValue={course.overview ?? ""}
              className={textareaClassFor(8)}
            />
          </Field>
          {/* Beside the boxes it governs rather than in a panel above the
                  whole form: a depth marker is typed into this section's prose,
                  and it is the one piece of syntax this editor asks a shop to
                  learn. Unboxed, like everything else in a section now. */}
          <p className="text-sm text-muted">
            {t.rich("courses.edit.depthMarkersHint", {
              marker: (chunks) => (
                <code className="rounded bg-surface-sunken px-1 font-mono text-xs text-foreground">
                  {chunks}
                </code>
              ),
            })}
          </p>
        </FieldGrid>
      </CourseSection>

      <CourseSection as="fieldset" {...pricing} description={t("courses.edit.pricingDescription")}>
        <FieldGrid columns={2} className="gap-y-5">
          <PriceField
            id="price"
            name="price"
            label={t("courses.edit.instructionFeeLabel")}
            cents={course.priceCents}
            currency={currency}
            locale={locale}
            copy={forgivingCopy(t)}
          />
          <PriceField
            id="eLearningPrice"
            name="eLearningPrice"
            label={t("courses.edit.eLearningFeeLabel")}
            hint={t("courses.edit.eLearningFeeHint")}
            cents={course.eLearningPriceCents}
            currency={currency}
            locale={locale}
            copy={forgivingCopy(t)}
          />
          <PriceField
            id="privatePrice"
            name="privatePrice"
            label={t("courses.edit.privatePriceLabel")}
            hint={t("courses.edit.privatePriceHint")}
            cents={course.privatePriceCents}
            currency={currency}
            locale={locale}
            copy={forgivingCopy(t)}
          />
        </FieldGrid>
      </CourseSection>
    </>
  );
}
