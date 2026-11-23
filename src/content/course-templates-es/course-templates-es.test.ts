import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "../course-templates";
import { COURSE_TEMPLATE_COPY_ES } from "./index";
import { courseTemplateCopyProblems } from "./types";

// Issue #4915: every course template has a whole Spanish twin, one `it` per slug so a translator
// can run `pnpm test course-templates-es -t "<slug>"`.
describe("the Spanish twin of every course template", () => {
  it.each(COURSE_TEMPLATES.map((template) => [template.slug, template] as const))(
    "%s is whole",
    (slug, template) => {
      expect(courseTemplateCopyProblems(template, COURSE_TEMPLATE_COPY_ES[slug])).toEqual([]);
    },
  );

  it("has no twin for a template that does not exist", () => {
    const slugs = new Set(COURSE_TEMPLATES.map((template) => template.slug));
    expect(Object.keys(COURSE_TEMPLATE_COPY_ES).filter((slug) => !slugs.has(slug))).toEqual([]);
  });
});
