import { describe, expect, it } from "vitest";
import {
  COURSE_INQUIRY_EXPERIENCE,
  type CourseInquiry,
  courseInquiryBody,
  courseInquiryMailto,
  courseInquirySubject,
  telHref,
} from "./course-inquiry";

function inquiry(overrides: Partial<CourseInquiry> = {}): CourseInquiry {
  return {
    courseTitle: "Open Water Diver",
    shopName: "Blue Mantis Divers",
    name: "Priya Sharma",
    timing: "the week of 12 August",
    divers: 2,
    experience: COURSE_INQUIRY_EXPERIENCE[0],
    message: "",
    ...overrides,
  };
}

describe("courseInquirySubject", () => {
  it("names the course so the shop can file it without opening it", () => {
    expect(courseInquirySubject({ courseTitle: "  Rescue Diver " })).toBe(
      "Course inquiry: Rescue Diver",
    );
  });
});

describe("courseInquiryBody", () => {
  it("puts every answer on its own line, in a fixed order", () => {
    expect(courseInquiryBody(inquiry())).toBe(
      [
        "Hello Blue Mantis Divers,",
        "",
        "I would like to take the Open Water Diver course.",
        "",
        "When: the week of 12 August",
        "How many divers: 2",
        "Experience so far: I have never dived before",
        "",
        "Thank you,",
        "Priya Sharma",
      ].join("\n"),
    );
  });

  it("keeps the diver's own words last, where a long note cannot bury the answers", () => {
    const body = courseInquiryBody(inquiry({ message: "We are on a cruise, so dates are tight." }));
    expect(body).toContain("How many divers: 2\n");
    expect(body).toContain("\nWe are on a cruise, so dates are tight.\n");
    expect(body.indexOf("cruise")).toBeGreaterThan(body.indexOf("Experience so far"));
  });

  // A blank line reads as a field the shop failed to receive; "Not said" reads
  // as a question the diver has not answered yet, which is the truth.
  it("marks unanswered questions rather than leaving an empty line", () => {
    const body = courseInquiryBody(inquiry({ timing: "   ", name: "", experience: "" }));
    expect(body).toContain("When: Not said");
    expect(body).toContain("Experience so far: Not said");
    expect(body.endsWith("Thank you,")).toBe(true);
    expect(body).not.toMatch(/: *\n/);
  });

  // "How many divers" is as optional as every other contact field — leaving it
  // blank must not force a guessed count into the message.
  it("marks an unanswered diver count the same way as the other optional fields", () => {
    const body = courseInquiryBody(inquiry({ divers: null }));
    expect(body).toContain("How many divers: Not said");
  });
});

describe("courseInquiryMailto", () => {
  it("percent-encodes the whole body so no client truncates it at the first line", () => {
    const href = courseInquiryMailto("hello@bluemantis.example", inquiry());
    expect(href.startsWith("mailto:hello%40bluemantis.example?")).toBe(true);
    expect(href).not.toContain("\n");
    // A literal "+" in a subject or body renders as a plus, not a space.
    expect(href).not.toContain("+");

    const url = new URL(href);
    const params = new URLSearchParams(url.search);
    expect(params.get("subject")).toBe("Course inquiry: Open Water Diver");
    expect(params.get("body")).toBe(courseInquiryBody(inquiry()));
  });

  it("survives an ampersand in the course title without splitting the query", () => {
    const href = courseInquiryMailto(
      "hi@shop.example",
      inquiry({ courseTitle: "Stress & Rescue" }),
    );
    const params = new URLSearchParams(new URL(href).search);
    expect(params.get("subject")).toBe("Course inquiry: Stress & Rescue");
    expect(params.get("body")).toContain("the Stress & Rescue course");
  });
});

describe("telHref", () => {
  it("dials a printed number", () => {
    expect(telHref("+1 (305) 555-0134")).toBe("tel:+13055550134");
  });
});
