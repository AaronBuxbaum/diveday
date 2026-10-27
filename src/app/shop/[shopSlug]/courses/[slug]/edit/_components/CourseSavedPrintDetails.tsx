import { SavedPrintDetails } from "@/components/editor/SavedPrintDetails";
import { diverTranslator } from "@/i18n/messages";
import type { DiverLocale } from "@/i18n/settings";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { courseDepthFormat } from "@/i18n/unit-labels";
import { resolveCourseContentDepths } from "@/lib/courses";
import type { DepthUnit } from "@/lib/depth-units";
import type { EditableCourse } from "./course-types";

/** Supplementary saved prose never reads a browser draft or a signed form's answers. */
export function CourseSavedPrintDetails({
  course: stored,
  display,
  t,
  formsPanel,
}: {
  course: EditableCourse;
  display: { locale: DiverLocale; depthUnit: DepthUnit; levelAge: string };
  t: StaffTranslator;
  formsPanel: {
    forms: readonly { id: string; title: string }[];
    required: readonly string[];
    ageBounds?: ReadonlyMap<string, number>;
  } | null;
}) {
  const { locale, depthUnit, levelAge } = display;
  const formTitles =
    formsPanel?.required.map((id) => {
      const title = formsPanel.forms.find((form) => form.id === id)?.title;
      const age = formsPanel.ageBounds?.get(id);
      return title && age ? `${title} · ${t("courses.edit.forms.maxAgeLabel")} ${age}` : title;
    }) ?? [];
  const course = resolveCourseContentDepths(
    stored,
    courseDepthFormat(diverTranslator(locale), depthUnit),
  );
  return (
    <SavedPrintDetails
      title={t("shared.formDraft.savedDetails")}
      sections={[
        { title: t("courses.edit.prerequisiteLabel"), lines: [levelAge, course.prerequisiteNote] },
        { title: t("courses.edit.includedLabel"), lines: course.includes },
        { title: t("courses.edit.notIncludedLabel"), lines: course.excludes },
        {
          title: t("courses.edit.materialsLegend"),
          lines: course.learningMaterials.map((material) =>
            [material.name, material.note, material.url].filter(Boolean).join(" · "),
          ),
        },
        ...course.faqs.map((faq) => ({ title: faq.question, lines: [faq.answer] })),
        { title: t("courses.edit.forms.legend"), lines: formTitles },
      ]}
    />
  );
}
