// i18n-exempt-file: Spanish starter course content, the twin of course-templates.ts, not app UI copy.

import type { CourseTemplate } from "../course-templates";

/**
 * **The Spanish twin of one course template's words** (issue #4915). It is shaped like the template's
 * prose fields, in the same order and with the same number of items, so each Spanish string sits beside
 * the English it replaces. A diver reading in Spanish sees it only where the shop's course still says
 * exactly what the template said; anything the shop edited stays the shop's own words
 * (`withLocalizedTemplateCopy`, src/features/training/course-template-localization.ts).
 *
 * Titles stay English: the course-name ladder is declared rather than translated
 * (src/i18n/locales/es-ES/README.md). Every `{depth18}`-style marker is kept verbatim.
 */
export type CourseTemplateCopyEs = {
  description?: string;
  summary?: string;
  overview?: string;
  durationText?: string;
  groupSizeText?: string;
  prerequisiteNote?: string;
  includes?: string[];
  excludes?: string[];
  scheduleDays?: { title: string; items: string[] }[];
  faqs?: { question: string; answer: string }[];
};

type Pair = readonly [english: string, spanish: string];

/** Every English string of a template beside its Spanish twin, in reading order. */
export function courseTemplateCopyPairs(
  template: CourseTemplate,
  copy: CourseTemplateCopyEs,
): Pair[] {
  const { content } = template;
  const pairs: Pair[] = [];
  const add = (english: string | null | undefined, spanish: string | undefined) => {
    if (english && spanish) pairs.push([english, spanish]);
  };
  add(template.description, copy.description);
  add(content.summary, copy.summary);
  add(content.overview, copy.overview);
  add(content.durationText, copy.durationText);
  add(content.groupSizeText, copy.groupSizeText);
  add(content.prerequisiteNote, copy.prerequisiteNote);
  content.includes.forEach((item, i) => {
    add(item, copy.includes?.[i]);
  });
  content.excludes.forEach((item, i) => {
    add(item, copy.excludes?.[i]);
  });
  content.scheduleDays.forEach((day, i) => {
    add(day.title, copy.scheduleDays?.[i]?.title);
    day.items.forEach((item, j) => {
      add(item, copy.scheduleDays?.[i]?.items[j]);
    });
  });
  content.faqs.forEach((faq, i) => {
    add(faq.question, copy.faqs?.[i]?.question);
    add(faq.answer, copy.faqs?.[i]?.answer);
  });
  return pairs;
}

const MARKER = /\{depth\d+n?\}/g;

/** The digits a sentence carries, with the depth markers taken out: ages, hours and counts must not drift in translation. */
const numbersIn = (text: string): string =>
  text.replace(MARKER, "").match(/\d+/g)?.sort().join() ?? "";

/** What is wrong with a template's Spanish twin, one sentence each; empty when it is whole. */
export function courseTemplateCopyProblems(
  template: CourseTemplate,
  copy: CourseTemplateCopyEs | undefined,
): string[] {
  if (!copy) return [`${template.slug} has no Spanish twin`];
  const { content } = template;
  const problems: string[] = [];
  const need = (label: string, english: string | null | undefined, spanish: string | undefined) => {
    if (!english) return;
    if (!spanish?.trim()) {
      problems.push(`${label} is missing`);
      return;
    }
    const wanted = [...english.matchAll(MARKER)].map((m) => m[0]).sort();
    const got = [...spanish.matchAll(MARKER)].map((m) => m[0]).sort();
    if (wanted.join() !== got.join()) problems.push(`${label} changes its depth markers`);
    if (numbersIn(english) !== numbersIn(spanish)) problems.push(`${label} changes a number`);
    if (spanish === english && english.length > 30) problems.push(`${label} is still English`);
  };
  need("description", template.description, copy.description);
  need("summary", content.summary, copy.summary);
  need("overview", content.overview, copy.overview);
  need("durationText", content.durationText, copy.durationText);
  need("groupSizeText", content.groupSizeText, copy.groupSizeText);
  need("prerequisiteNote", content.prerequisiteNote, copy.prerequisiteNote);
  const sameLength = (
    label: string,
    english: readonly unknown[],
    spanish: readonly unknown[] | undefined,
  ) => {
    if ((spanish?.length ?? 0) !== english.length)
      problems.push(`${label} has the wrong number of items`);
  };
  sameLength("includes", content.includes, copy.includes);
  sameLength("excludes", content.excludes, copy.excludes);
  sameLength("scheduleDays", content.scheduleDays, copy.scheduleDays);
  sameLength("faqs", content.faqs, copy.faqs);
  content.includes.forEach((item, i) => {
    need(`includes[${i}]`, item, copy.includes?.[i]);
  });
  content.excludes.forEach((item, i) => {
    need(`excludes[${i}]`, item, copy.excludes?.[i]);
  });
  content.scheduleDays.forEach((day, i) => {
    need(`scheduleDays[${i}].title`, day.title, copy.scheduleDays?.[i]?.title);
    sameLength(`scheduleDays[${i}].items`, day.items, copy.scheduleDays?.[i]?.items);
    day.items.forEach((item, j) => {
      need(`scheduleDays[${i}].items[${j}]`, item, copy.scheduleDays?.[i]?.items[j]);
    });
  });
  content.faqs.forEach((faq, i) => {
    need(`faqs[${i}].question`, faq.question, copy.faqs?.[i]?.question);
    need(`faqs[${i}].answer`, faq.answer, copy.faqs?.[i]?.answer);
  });
  return problems;
}
