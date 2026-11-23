import { describe, expect, it } from "vitest";
import { COURSE_TEMPLATES } from "../../content/course-templates";
import { COURSE_TEMPLATE_COPY_ES } from "../../content/course-templates-es";
import { withLocalizedTemplateCopy } from "./course-template-localization";

// Issue #4915: a Spanish reader gets the template's Spanish wherever the course still says what the template said.
const template = COURSE_TEMPLATES.find((candidate) => candidate.slug === "open-water-diver");
const twin = COURSE_TEMPLATE_COPY_ES["open-water-diver"];
if (!template || !twin) throw new Error("the Open Water template and its twin must exist");

const fromTemplate = () => ({
  description: template.description,
  summary: template.content.summary,
  overview: template.content.overview,
  durationText: template.content.durationText,
  groupSizeText: template.content.groupSizeText,
  prerequisiteNote: template.content.prerequisiteNote,
  includes: [...template.content.includes],
  excludes: [...template.content.excludes],
  scheduleDays: template.content.scheduleDays.map((day) => ({ ...day })),
  faqs: template.content.faqs.map((faq) => ({ ...faq })),
});

describe("withLocalizedTemplateCopy", () => {
  it("gives a Spanish reader the Spanish twin of an untouched template, markers kept", () => {
    const course = withLocalizedTemplateCopy(fromTemplate(), "es-ES");
    expect(course.overview).toBe(twin.overview);
    expect(course.overview).toContain("{depth18}");
    expect(course.faqs[0]).toEqual(twin.faqs?.[0]);
    expect(course.scheduleDays[0]?.title).toBe(twin.scheduleDays?.[0]?.title);
    expect(course.scheduleDays[0]?.startTime).toBe(template.content.scheduleDays[0]?.startTime);
    expect(course.includes).toEqual(twin.includes);
  });

  it("leaves an English reader's course exactly as it is", () => {
    const course = fromTemplate();
    expect(withLocalizedTemplateCopy(course, "en-US")).toBe(course);
  });

  it("keeps a sentence the shop edited and translates the ones it did not", () => {
    const course = fromTemplate();
    course.summary = "Our own pitch for Open Water.";
    const edited = course.faqs[1];
    if (!edited) throw new Error("expected a second question");
    edited.answer = "Any stroke counts, and the swim has no clock.";
    const out = withLocalizedTemplateCopy(course, "es-ES");
    expect(out.summary).toBe("Our own pitch for Open Water.");
    expect(out.faqs[1]?.answer).toBe("Any stroke counts, and the swim has no clock.");
    expect(out.faqs[1]?.question).toBe(twin.faqs?.[1]?.question);
    expect(out.faqs[0]).toEqual(twin.faqs?.[0]);
  });

  it("leaves a course the shop wrote itself alone", () => {
    const own = {
      summary: "A weekend with us.",
      overview: null,
      durationText: "2 days",
      groupSizeText: null,
      prerequisiteNote: null,
      includes: ["Lunch"],
      excludes: [],
      scheduleDays: [{ title: "Saturday", items: ["Pool"] }],
      faqs: [{ question: "Is there parking?", answer: "Yes." }],
    };
    expect(withLocalizedTemplateCopy(own, "es-ES")).toEqual(own);
  });
});
