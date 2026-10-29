import { parseCourseTemplateSnapshot } from "./course-template-sync";
import type { CourseFaq } from "./courses";

type TemplateBackedCourseCopy = {
  sourceTemplateSlug: string | null;
  sourceTemplateSnapshot: unknown;
  includes: string[];
  faqs: CourseFaq[];
};

export type OpenWaterTemplateCopy = {
  certificationFees: string;
  elearningQuestion: string;
  elearningAnswer: string;
};

const OPEN_WATER_TEMPLATE_SLUG = "open-water-diver";
const OPEN_WATER_INCLUDE_DEFAULTS = new Set([
  "All PADI learning materials and certification fees",
  "PADI certification fees",
]);
const OPEN_WATER_ELEARNING_FAQ = {
  question: "Can I do the theory before I arrive?",
  answer:
    "Yes, and most students do. PADI eLearning is a separate fee, billed as its own line, and finishing it beforehand frees your days for diving.",
};

/**
 * Translate only the untouched Open Water template claims for a Spanish reader.
 * A saved source snapshot is required so shop-created courses and shop-edited
 * copy remain exactly as the shop wrote them.
 */
export function withLocalizedOpenWaterTemplateCopy<T extends TemplateBackedCourseCopy>(
  course: T,
  copy: OpenWaterTemplateCopy,
): T {
  if (course.sourceTemplateSlug !== OPEN_WATER_TEMPLATE_SLUG) return course;
  const baseline = parseCourseTemplateSnapshot(course.sourceTemplateSnapshot);
  if (!baseline) return course;

  const includes = course.includes.map((item) =>
    OPEN_WATER_INCLUDE_DEFAULTS.has(item) && baseline.includes.includes(item)
      ? copy.certificationFees
      : item,
  );
  const faqs = course.faqs.map((faq) => {
    const isDefaultFaq =
      faq.question === OPEN_WATER_ELEARNING_FAQ.question &&
      faq.answer === OPEN_WATER_ELEARNING_FAQ.answer &&
      baseline.faqs.some(
        (baselineFaq) => baselineFaq.question === faq.question && baselineFaq.answer === faq.answer,
      );
    return isDefaultFaq ? { question: copy.elearningQuestion, answer: copy.elearningAnswer } : faq;
  });

  return { ...course, includes, faqs };
}
