import { describe, expect, it } from "vitest";
import { diverTranslator } from "@/i18n/messages";
import {
  COURSE_INQUIRY_EXPERIENCE,
  type CourseInquiry,
  courseInquiryBody,
  courseInquiryMailto,
  courseInquirySubject,
  formatPreferredDate,
  telHref,
} from "./course-inquiry";

const t = diverTranslator("en-US");

function inquiry(overrides: Partial<CourseInquiry> = {}): CourseInquiry {
  return {
    courseTitle: "Open Water Diver",
    shopName: "Blue Mantis Divers",
    name: "Priya Sharma",
    timing: "the week of 12 August",
    preferredDate: "",
    divers: 2,
    experience: COURSE_INQUIRY_EXPERIENCE[0],
    message: "",
    ...overrides,
  };
}

describe("courseInquirySubject", () => {
  it("names the course so the shop can file it without opening it", () => {
    expect(courseInquirySubject(t, { courseTitle: "  Rescue Diver " })).toBe(
      "Course inquiry: Rescue Diver",
    );
  });
});

describe("courseInquiryBody", () => {
  it("puts every answer on its own line, in a fixed order", () => {
    expect(courseInquiryBody(t, inquiry())).toBe(
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
    const body = courseInquiryBody(
      t,
      inquiry({ message: "We are on a cruise, so dates are tight." }),
    );
    expect(body).toContain("How many divers: 2\n");
    expect(body).toContain("\nWe are on a cruise, so dates are tight.\n");
    expect(body.indexOf("cruise")).toBeGreaterThan(body.indexOf("Experience so far"));
  });

  // A blank line reads as a field the shop failed to receive; "Not said" reads
  // as a question the diver has not answered yet, which is the truth.
  it("marks unanswered questions rather than leaving an empty line", () => {
    const body = courseInquiryBody(t, inquiry({ timing: "   ", name: "", experience: "" }));
    expect(body).toContain("When: Not said");
    expect(body).toContain("Experience so far: Not said");
    expect(body.endsWith("Thank you,")).toBe(true);
    expect(body).not.toMatch(/: *\n/);
  });

  // "How many divers" is as optional as every other contact field — leaving it
  // blank must not force a guessed count into the message.
  it("marks an unanswered diver count the same way as the other optional fields", () => {
    const body = courseInquiryBody(t, inquiry({ divers: null }));
    expect(body).toContain("How many divers: Not said");
  });

  it("resolves an experience code through its own bundle key, never a raw code", () => {
    const body = courseInquiryBody(t, inquiry({ experience: "lapsed" }));
    expect(body).toContain("Experience so far: I am certified, but it has been a while");
  });

  // A diver who names a date is answering the question the shop asks first,
  // so it leads the facts — above the rough "when suits you", which stays
  // because the two are different answers.
  it("leads with a requested date when the diver named one", () => {
    const body = courseInquiryBody(t, inquiry({ preferredDate: "August 12, 2026" }));
    expect(body).toContain("Date I have in mind: August 12, 2026\nWhen: the week of 12 August");
  });

  // Unlike "When" and "How many divers", an unnamed date takes its whole line
  // out: a "Not said" here is a line the shop reads and learns nothing from.
  it("removes the date line entirely when no date was picked", () => {
    const body = courseInquiryBody(t, inquiry());
    expect(body).not.toContain("Date I have in mind");
    expect(body).not.toContain("Not said");
    // And no empty line left where it would have been.
    expect(body).toContain("course.\n\nWhen: ");
  });

  it("treats a whitespace-only date the same as none", () => {
    expect(courseInquiryBody(t, inquiry({ preferredDate: "   " }))).not.toContain(
      "Date I have in mind",
    );
  });
});

describe("formatPreferredDate", () => {
  it("writes a bare calendar day the way the reader's locale does", () => {
    expect(formatPreferredDate("2026-08-12", "en-US")).toBe("August 12, 2026");
    expect(formatPreferredDate("2026-08-12", "es-ES")).toBe("12 de agosto de 2026");
  });

  // The bug this guards: `new Date("2026-08-12")` is UTC midnight, so
  // formatting it in a western zone would render the 11th — a shop reading a
  // date one day off is a diver who turns up on the wrong morning.
  it("never shifts the day, whatever the reader's zone", () => {
    expect(formatPreferredDate("2026-01-01", "en-US")).toBe("January 1, 2026");
    expect(formatPreferredDate("2026-12-31", "en-US")).toBe("December 31, 2026");
  });

  it("refuses anything that is not a bare YYYY-MM-DD", () => {
    expect(formatPreferredDate("", "en-US")).toBeNull();
    expect(formatPreferredDate("12/08/2026", "en-US")).toBeNull();
    expect(formatPreferredDate("2026-08-12T10:00:00Z", "en-US")).toBeNull();
    expect(formatPreferredDate("2026-13-45", "en-US")).toBeNull();
  });
});

describe("courseInquiryMailto", () => {
  it("percent-encodes the whole body so no client truncates it at the first line", () => {
    const href = courseInquiryMailto(t, "hello@demo.invalid", inquiry());
    expect(href.startsWith("mailto:hello%40demo.invalid?")).toBe(true);
    expect(href).not.toContain("\n");
    // A literal "+" in a subject or body renders as a plus, not a space.
    expect(href).not.toContain("+");

    const url = new URL(href);
    const params = new URLSearchParams(url.search);
    expect(params.get("subject")).toBe("Course inquiry: Open Water Diver");
    expect(params.get("body")).toBe(courseInquiryBody(t, inquiry()));
  });

  it("survives an ampersand in the course title without splitting the query", () => {
    const href = courseInquiryMailto(
      t,
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
