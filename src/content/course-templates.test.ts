import { describe, expect, it } from "vitest";
import { COURSE_FORM_TITLE_MAX } from "@/lib/course-forms";
import {
  COURSE_CONTENT_LIMITS,
  type CourseDepthFormat,
  courseDepthPlaceholderIssues,
  resolveCourseContentDepths,
} from "@/lib/courses";
import { COURSE_TEMPLATES } from "./course-templates";

describe("standard course forms", () => {
  it("names a title the form editor can hold, and where the agency names it", () => {
    for (const template of COURSE_TEMPLATES) {
      for (const form of template.standardForms ?? []) {
        expect(form.title.length).toBeLessThanOrEqual(COURSE_FORM_TITLE_MAX);
        expect(form.source.agency).toBe(template.agency);
        expect(form.source.url).toMatch(/^https:\/\/[a-z-]+\.padi\.com\//);
        expect(form.source.productNumber).toMatch(/^\d+$/);
      }
    }
  });

  it("asks Open Water for the release, the safe-practices statement and the youth acknowledgment, and continuing education for its one document", () => {
    const products = (slug: string) =>
      (COURSE_TEMPLATES.find((template) => template.slug === slug)?.standardForms ?? []).map(
        (form) => form.source.productNumber,
      );
    expect(products("open-water-diver")).toEqual(["10072", "10060", "10615"]);
    // The youth acknowledgment is for 10- and 11-year-olds only (issue #2265).
    const youth = COURSE_TEMPLATES.find(
      (template) => template.slug === "open-water-diver",
    )?.standardForms?.find((form) => form.source.productNumber === "10615");
    expect(youth?.maxAgeYears).toBe(11);
    expect(products("advanced-open-water-diver")).toEqual(["10038"]);
    expect(products("rescue-diver")).toEqual(["10038"]);
    // No list where the manual names none DiveDay could read (issue #2264),
    // and none for a course with no dive in it: the two of those agree.
    expect(products("discover-scuba-diving")).toEqual([]);
    expect(products("scuba-refresher")).toEqual([]);
    expect(products("divemaster")).toEqual([]);
    expect(products("emergency-oxygen-provider")).toEqual([]);
    expect(products("equipment-specialist")).toEqual([]);
  });
});

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

describe("SDI templates", () => {
  it("gate at SDI's own floor, Open Water Scuba Diver, where the ladder can say it", () => {
    // SDI asks Open Water Scuba Diver for Rescue, Deep and Wreck; its Advanced
    // Adventure Diver is built from those dives. An Advanced gate told an SDI
    // Open Water diver the agency wanted more and to phone instead of book.
    for (const slug of ["sdi-rescue-diver", "sdi-deep-diver", "sdi-wreck-diver"]) {
      const template = COURSE_TEMPLATES.find((entry) => entry.slug === slug);
      expect(template?.minimumCertificationLevel, slug).toBe("open_water");
      const note = template?.content.prerequisiteNote ?? "";
      expect(note, slug).toContain("SDI Open Water Scuba Diver or equivalent");
      expect(note, slug).not.toMatch(/Advanced Adventure|between Open Water and Advanced/);
    }
    expect(
      COURSE_TEMPLATES.find((entry) => entry.slug === "sdi-rescue-diver")?.content.prerequisiteNote,
    ).toContain("SDI Open Water Scuba Diver or equivalent, plus current CPR and first aid");
  });

  it("name a minimum age, and say the parental consent under 18 that SDI asks for", () => {
    // The course age gate passes a null, so an SDI page with no age sold Deep
    // Diver to anyone (issue #2682). Every SDI template puts a diver in the
    // water, and SDI publishes an age for each. The entry courses word their
    // junior rules their own way, and SDI's refresher standard names no consent.
    const ownWording = new Set([
      "sdi-scuba-discovery",
      "sdi-open-water-scuba-diver",
      "sdi-inactive-diver-scuba-refresher",
    ]);
    for (const template of COURSE_TEMPLATES.filter((entry) => entry.agency === "sdi")) {
      const age = template.content.minimumAge;
      expect(age, template.slug).toEqual(expect.any(Number));
      const note = template.content.prerequisiteNote ?? "";
      if (age !== null && age < 18 && !ownWording.has(template.slug)) {
        expect(note, template.slug).toContain(
          "divers under 18 need a parent's or guardian's consent",
        );
      }
    }
  });

  it("take SDI's own ages for the continuing-education courses", () => {
    const ages = Object.fromEntries(
      COURSE_TEMPLATES.filter((entry) => entry.agency === "sdi").map((entry) => [
        entry.slug,
        entry.content.minimumAge,
      ]),
    );
    expect(ages).toMatchObject({
      "sdi-advanced-adventure-diver": 10,
      "sdi-computer-nitrox-diver": 10,
      "sdi-deep-diver": 10,
      "sdi-underwater-navigation": 10,
      "sdi-night-limited-visibility-diver": 10,
      "sdi-wreck-diver": 15,
    });
    // DiveDay's junior bands (src/lib/depth-ceiling.ts) are stricter than SDI's
    // 21 m for 10–14: 12 m at 10–11, 18 m at 12–14 unless the card is advanced.
    // The note and the depth FAQ both have to say so; a parent reads the FAQ.
    for (const slug of ["sdi-advanced-adventure-diver", "sdi-deep-diver"]) {
      const content = COURSE_TEMPLATES.find((entry) => entry.slug === slug)?.content;
      const depthFaq = content?.faqs.find((faq) => faq.question.startsWith("How deep"))?.answer;
      for (const text of [content?.prerequisiteNote, depthFaq]) {
        expect(text, slug).toContain("{depth12} at 10–11, and {depth18} at 12–14");
      }
    }
  });
});
