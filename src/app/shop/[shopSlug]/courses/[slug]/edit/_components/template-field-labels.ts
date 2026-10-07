import type { StaffTranslator } from "@/i18n/staff-messages";
import type { CourseTemplateField } from "@/lib/course-template-sync";

/** What each field a template update can carry is called in the "Template update" panel. */
export function courseTemplateFieldLabels(t: StaffTranslator): Record<CourseTemplateField, string> {
  return {
    title: t("courses.edit.templateUpdates.fields.title"),
    agency: t("courses.edit.templateUpdates.fields.agency"),
    description: t("courses.edit.templateUpdates.fields.description"),
    minimumCertificationLevel: t("courses.edit.templateUpdates.fields.minimumCertificationLevel"),
    certifiesLevel: t("courses.edit.templateUpdates.fields.certifiesLevel"),
    minimumAge: t("courses.edit.templateUpdates.fields.minimumAge"),
    isIntroCourse: t("courses.edit.templateUpdates.fields.isIntroCourse"),
    summary: t("courses.edit.templateUpdates.fields.summary"),
    overview: t("courses.edit.templateUpdates.fields.overview"),
    durationText: t("courses.edit.templateUpdates.fields.durationText"),
    groupSizeText: t("courses.edit.templateUpdates.fields.groupSizeText"),
    prerequisiteNote: t("courses.edit.templateUpdates.fields.prerequisiteNote"),
    includes: t("courses.edit.templateUpdates.fields.includes"),
    excludes: t("courses.edit.templateUpdates.fields.excludes"),
    scheduleDays: t("courses.edit.templateUpdates.fields.scheduleDays"),
    faqs: t("courses.edit.templateUpdates.fields.faqs"),
  };
}
