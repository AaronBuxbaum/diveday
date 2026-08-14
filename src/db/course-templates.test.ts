import { describe, expect, it } from "vitest";
import {
  COURSE_CONTENT_LIMITS,
  type CourseDepthFormat,
  courseDepthPlaceholderIssues,
  resolveCourseContentDepths,
} from "@/lib/courses";
import { COURSE_TEMPLATES } from "./course-templates";

/** Every string in a template that a diver ever reads. */
function proseOf(template: (typeof COURSE_TEMPLATES)[number]): string[] {
  const { content } = template;
  return [
    template.description,
    content.summary,
    content.overview,
    content.durationText,
    content.groupSizeText,
    content.prerequisiteNote,
    ...content.includes,
    ...content.excludes,
    ...content.scheduleDays.flatMap((day) => [day.title, ...day.items]),
    ...content.faqs.flatMap((faq) => [faq.question, faq.answer]),
  ].filter((text): text is string => typeof text === "string");
}

describe("COURSE_TEMPLATES depth markers", () => {
  it("carries no broken marker, in any template", () => {
    // These strings are copied verbatim into a shop's own row at seed/import
    // and are the starting point every shop edits, so a typo here is a typo
    // published under thirty shops' names.
    for (const template of COURSE_TEMPLATES) {
      for (const text of proseOf(template)) {
        expect(courseDepthPlaceholderIssues(text), `${template.slug}: ${text}`).toEqual([]);
      }
    }
  });

  it("states no depth as a fixed unit, so every shop reads its own", () => {
    // The regression this replaced: a Florida shop reading feet everywhere
    // else in the app was told "No deeper than 12 meters" by its own course
    // page. The swim test is the one exception — "200-meter/yard" is PADI's
    // own wording for two distances treated as equivalent, so there is no
    // pair to look up and nothing to convert.
    for (const template of COURSE_TEMPLATES) {
      for (const text of proseOf(template)) {
        const depthWords = text.replace(/200-meter(\/yard)?|300-meter/g, "").match(/meters?|feet/g);
        expect(depthWords, `${template.slug}: ${text}`).toBeNull();
      }
    }
  });

  it("reads as ordinary prose once resolved, in either unit", () => {
    const meters: CourseDepthFormat = { unit: "meters", withUnit: (v) => `${v} meters` };
    const feet: CourseDepthFormat = { unit: "feet", withUnit: (v) => `${v} feet` };
    const discover = COURSE_TEMPLATES.find((t) => t.slug === "discover-scuba-diving");
    if (!discover) throw new Error("discover-scuba-diving template is missing");

    const inMeters = resolveCourseContentDepths(discover.content, meters);
    const inFeet = resolveCourseContentDepths(discover.content, feet);
    expect(inMeters.faqs.map((faq) => faq.answer).join(" ")).toContain("No deeper than 12 meters");
    expect(inFeet.faqs.map((faq) => faq.answer).join(" ")).toContain("No deeper than 40 feet");
    // Nothing anywhere still carries a raw marker after the pass.
    for (const template of COURSE_TEMPLATES) {
      const resolved = JSON.stringify(resolveCourseContentDepths(template.content, feet));
      expect(resolved, template.slug).not.toContain("{depth");
    }
  });
  it("fits through the editor a shop edits it in", () => {
    // A published template is seed content: a shop copies it and then edits it
    // in the course-page form. So every template has to fit that form's own
    // limits, or a shop opening the course and changing one word is refused —
    // with the cursor thrown into a box it never touched. Seven templates were
    // over the prerequisite-note ceiling before this test existed (Wreck
    // Diver's note is 510 characters against a limit of 400), which made the
    // whole course uneditable.
    const textOf: Record<string, (c: (typeof COURSE_TEMPLATES)[number]["content"]) => string> = {
      summary: (c) => c.summary ?? "",
      overview: (c) => c.overview ?? "",
      durationText: (c) => c.durationText ?? "",
      groupSizeText: (c) => c.groupSizeText ?? "",
      prerequisiteNote: (c) => c.prerequisiteNote ?? "",
      includes: (c) => (c.includes ?? []).join("\n"),
      excludes: (c) => (c.excludes ?? []).join("\n"),
    };
    for (const template of COURSE_TEMPLATES) {
      for (const [field, read] of Object.entries(textOf)) {
        const limit = COURSE_CONTENT_LIMITS[field as keyof typeof COURSE_CONTENT_LIMITS];
        expect(
          read(template.content).trim().length,
          `${template.slug}.${field}`,
        ).toBeLessThanOrEqual(limit);
      }
    }
  });
});
