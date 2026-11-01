import type { StaffMessageKey } from "@/i18n/staff-messages";

type CourseEditorSectionDefinition = {
  id: string;
  labelKey: StaffMessageKey;
};

export const COURSE_EDITOR_OPEN_SECTIONS = [
  { id: "pitch", labelKey: "courses.edit.pitchLegend" },
  { id: "pricing", labelKey: "courses.edit.pricingLegend" },
  { id: "glance", labelKey: "courses.edit.glanceLegend" },
  { id: "scheduleDaysJson", labelKey: "courses.edit.dayByDayLegend" },
] as const satisfies readonly CourseEditorSectionDefinition[];

export const COURSE_EDITOR_CLOSED_SECTIONS = [
  { id: "photos", labelKey: "courses.edit.photosLegend" },
  { id: "enroll", labelKey: "courses.edit.enrollLegend" },
  { id: "fee-covers", labelKey: "courses.edit.feeCoversLegend" },
  { id: "learningMaterialsJson", labelKey: "courses.edit.materialsLegend" },
  { id: "faq", labelKey: "courses.edit.faqLegend" },
] as const satisfies readonly CourseEditorSectionDefinition[];
