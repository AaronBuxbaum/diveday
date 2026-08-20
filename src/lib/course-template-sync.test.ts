import { describe, expect, it } from "vitest";
import {
  type CourseTemplateSource,
  courseTemplateDiff,
  courseTemplateSnapshot,
  mergedCourseTemplateSnapshot,
} from "./course-template-sync";

function template(overrides: Partial<CourseTemplateSource> = {}): CourseTemplateSource {
  return {
    title: "Open Water Diver",
    agency: "padi",
    description: "The foundational course.",
    minimumCertificationLevel: null,
    content: {
      summary: "Learn to dive",
      overview: "The original overview.",
      heroImageUrl: "/template.jpg",
      heroImageAlt: "",
      galleryPhotos: [{ url: "/gallery.jpg", alt: "" }],
      durationText: "3 days",
      groupSizeText: "8 students per instructor",
      minimumAge: 10,
      prerequisiteNote: "No certification required.",
      includes: ["Gear"],
      excludes: ["Park fees"],
      scheduleDays: [{ title: "Training", items: ["Skills"] }],
      faqs: [{ question: "Is gear included?", answer: "Yes." }],
      isIntroCourse: false,
    },
    ...overrides,
  };
}

describe("course template synchronization", () => {
  it("identifies shop edits separately from untouched fields", () => {
    const baseline = courseTemplateSnapshot(template());
    const current = { ...baseline, overview: "The shop's own explanation." };
    const latest = {
      ...baseline,
      summary: "Learn to dive with confidence",
      overview: "The updated source overview.",
    };

    expect(courseTemplateDiff(current, baseline, latest)).toEqual([
      expect.objectContaining({ field: "summary", shopChanged: false }),
      expect.objectContaining({ field: "overview", shopChanged: true }),
    ]);
  });

  it("preserves shop-edited prose while applying untouched template changes", () => {
    const baseline = courseTemplateSnapshot(template());
    const current = {
      ...baseline,
      overview: "The shop's own explanation.",
      includes: ["Shop gear", "Briefing"],
    };
    const latest = {
      ...baseline,
      summary: "Learn to dive with confidence",
      overview: "The updated source overview.",
      includes: ["Updated gear"],
      durationText: "3 full days",
    };

    expect(mergedCourseTemplateSnapshot(current, baseline, latest, "preserve-shop-edits")).toEqual({
      ...latest,
      overview: current.overview,
      includes: current.includes,
    });
  });

  it("only replaces template-owned fields in explicit replace mode", () => {
    const baseline = courseTemplateSnapshot(template());
    const current = { ...baseline, overview: "The shop's own explanation." };
    const latest = { ...baseline, overview: "The updated source overview." };

    expect(
      mergedCourseTemplateSnapshot(current, baseline, latest, "replace-template-copy"),
    ).toEqual(latest);
  });
});
