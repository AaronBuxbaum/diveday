import { COURSE_TEMPLATES } from "../../content/course-templates";
import { COURSE_TEMPLATE_COPY_ES } from "../../content/course-templates-es";
import { courseTemplateCopyPairs } from "../../content/course-templates-es/types";
import { parseCourseTemplateSnapshot } from "../../lib/course-template-sync";
import type { CourseFaq } from "../../lib/courses";

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

let spanishByEnglish: ReadonlyMap<string, string> | undefined;

/** Every English template string beside its Spanish twin, built once from the code-owned templates. */
function spanishTemplateCopy(): ReadonlyMap<string, string> {
  if (spanishByEnglish) return spanishByEnglish;
  const built = new Map<string, string>();
  for (const template of COURSE_TEMPLATES) {
    const twin = COURSE_TEMPLATE_COPY_ES[template.slug];
    if (!twin) continue;
    for (const [english, spanish] of courseTemplateCopyPairs(template, twin)) {
      built.set(english, spanish);
    }
  }
  spanishByEnglish = built;
  return built;
}

type LocalizableCourseCopy = {
  description?: string | null;
  summary: string | null;
  overview: string | null;
  durationText: string | null;
  groupSizeText: string | null;
  prerequisiteNote: string | null;
  includes: string[];
  excludes: string[];
  scheduleDays: { title: string; items: string[] }[];
  faqs: CourseFaq[];
};

/**
 * **A Spanish reader sees the template's Spanish wherever the course still says what the template
 * said** (issue #4915). A string matches when it is exactly the template's English, so a sentence the
 * shop edited, a course the shop wrote itself and a template version older than this one all stay in
 * the words they have. Run it before `resolveCourseContentDepths`: it matches the text with its
 * depth markers still in. English readers get the course back untouched.
 */
export function withLocalizedTemplateCopy<T extends LocalizableCourseCopy>(
  course: T,
  locale: string,
): T {
  if (locale !== "es-ES") return course;
  const copy = spanishTemplateCopy();
  const say = (text: string): string => copy.get(text) ?? text;
  const sayOrNull = (text: string | null): string | null => (text === null ? null : say(text));
  return {
    ...course,
    ...(course.description == null ? {} : { description: say(course.description) }),
    summary: sayOrNull(course.summary),
    overview: sayOrNull(course.overview),
    durationText: sayOrNull(course.durationText),
    groupSizeText: sayOrNull(course.groupSizeText),
    prerequisiteNote: sayOrNull(course.prerequisiteNote),
    includes: course.includes.map(say),
    excludes: course.excludes.map(say),
    scheduleDays: course.scheduleDays.map((day) => ({
      ...day,
      title: say(day.title),
      items: day.items.map(say),
    })),
    faqs: course.faqs.map((faq) => ({ question: say(faq.question), answer: say(faq.answer) })),
  };
}
