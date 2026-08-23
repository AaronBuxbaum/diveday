import { describe, expect, it } from "vitest";
import {
  bookingInvoiceLines,
  COURSE_DEPTHS,
  type CourseContent,
  type CourseDepthFormat,
  courseCharges,
  courseDepthPlaceholderIssues,
  courseSlug,
  courseTotalCents,
  formatScheduleDayTime,
  MAX_FAQS,
  parseLines,
  resolveCourseContentDepths,
  resolveCourseDepths,
  sanitizeFaqs,
  splitCourseImageUrls,
} from "./courses";
import { depthInUnit, feetToMeters, metersToFeet } from "./depth-units";

const blankContent: CourseContent = {
  summary: null,
  overview: null,
  heroImageUrl: null,
  heroImageAlt: null,
  galleryPhotos: [],
  durationText: null,
  groupSizeText: null,
  minimumAge: null,
  prerequisiteNote: null,
  includes: [],
  excludes: [],
  scheduleDays: [],
  faqs: [],
  isIntroCourse: false,
};

const openWater = {
  title: "Open Water Diver",
  priceCents: 49900,
  eLearningPriceCents: 21000,
};

describe("courseCharges", () => {
  it("invoices instruction and e-learning as separate lines, as parts not sentences", () => {
    // The course title is a shop-authored proper noun; the words around it
    // ("— instruction") belong to the caller's message bundle, so nothing here
    // returns English (docs ADR 20260731-domain-layer-copy-leaks).
    expect(courseCharges(openWater)).toEqual([
      {
        kind: "course_fee",
        courseTitle: "Open Water Diver",
        amountCents: 49900,
      },
      {
        kind: "e_learning_fee",
        courseTitle: "Open Water Diver",
        amountCents: 21000,
      },
    ]);
    for (const charge of courseCharges(openWater)) {
      expect(charge).not.toHaveProperty("description");
    }
  });

  it("omits an unpriced item rather than invoicing a zero line", () => {
    expect(courseCharges({ ...openWater, eLearningPriceCents: null })).toEqual([
      {
        kind: "course_fee",
        courseTitle: "Open Water Diver",
        amountCents: 49900,
      },
    ]);
    expect(courseCharges({ ...openWater, priceCents: null })).toEqual([
      {
        kind: "e_learning_fee",
        courseTitle: "Open Water Diver",
        amountCents: 21000,
      },
    ]);
  });

  it("keeps a free line as a real line, since zero is a price and null is not", () => {
    expect(courseCharges({ ...openWater, priceCents: 0 })).toHaveLength(2);
  });
});

describe("bookingInvoiceLines", () => {
  const trip = { title: "Open Water — July weekend", priceCents: 30000 };

  it("starts a course order at two lines so either can be cleared", () => {
    expect(bookingInvoiceLines({ trip, course: openWater })).toEqual([
      { kind: "course_fee", courseTitle: "Open Water Diver", amountCents: 49900 },
      { kind: "e_learning_fee", courseTitle: "Open Water Diver", amountCents: 21000 },
    ]);
  });

  it("falls back to the session's own price when the catalog entry is unpriced", () => {
    expect(bookingInvoiceLines({ trip, course: { ...openWater, priceCents: null } })).toEqual([
      { kind: "course_fee", courseTitle: "Open Water Diver", amountCents: 30000 },
      { kind: "e_learning_fee", courseTitle: "Open Water Diver", amountCents: 21000 },
    ]);
  });

  it("bills an ordinary charter as one trip fee", () => {
    expect(bookingInvoiceLines({ trip, course: null })).toEqual([
      { kind: "trip_fee", tripTitle: "Open Water — July weekend", amountCents: 30000 },
    ]);
  });

  it("leaves the amount blank rather than guessing when nothing is priced", () => {
    expect(
      bookingInvoiceLines({
        trip: { title: "Shore dive", priceCents: null },
        course: { title: "Open Water Diver", priceCents: null, eLearningPriceCents: null },
      }),
    ).toEqual([{ kind: "trip_fee", tripTitle: "Shore dive", amountCents: null }]);
  });

  it("composes at the boundary: kind + title become the line staff see", () => {
    // What the order form does with the parts — the words come from the staff
    // bundle (`orderLine.*`), the title from the shop's own catalog.
    const words = {
      course_fee: (title: string) => `${title} — instruction`,
      e_learning_fee: (title: string) => `${title} — e-learning`,
    };
    const composed = bookingInvoiceLines({ trip, course: openWater }).map((line) =>
      line.kind === "trip_fee" ? line.tripTitle : words[line.kind](line.courseTitle),
    );
    expect(composed).toEqual(["Open Water Diver — instruction", "Open Water Diver — e-learning"]);
    expect(
      bookingInvoiceLines({ trip, course: null }).map((line) =>
        line.kind === "trip_fee" ? line.tripTitle : "unreachable",
      ),
    ).toEqual(["Open Water — July weekend"]);
  });
});

describe("courseSlug", () => {
  it("makes a readable URL segment from a course title", () => {
    expect(courseSlug("Open Water Diver")).toBe("open-water-diver");
    expect(courseSlug("  Rescue Diver / EFR  ")).toBe("rescue-diver-efr");
  });

  it("never mints a slug that would shadow a staff route", () => {
    expect(courseSlug("Catalog")).toBe("catalog-course");
    expect(courseSlug("New")).toBe("new-course");
  });

  it("falls back rather than returning an empty segment", () => {
    expect(courseSlug("—")).toBe("course");
  });

  it("does not leave a trailing hyphen when the title is truncated mid-word", () => {
    expect(courseSlug(`${"a".repeat(79)} diver`)).toBe("a".repeat(79));
  });
});

describe("formatScheduleDayTime", () => {
  it("formats a real clock range from 24-hour start/end", () => {
    expect(
      formatScheduleDayTime({ title: "Day 1", startTime: "08:00", endTime: "17:00", items: [] }),
    ).toBe("8:00 AM – 5:00 PM");
  });

  it("formats a single clock time when only a start is set", () => {
    expect(formatScheduleDayTime({ title: "Check-in", startTime: "08:15", items: [] })).toBe(
      "8:15 AM",
    );
  });

  it("falls back to the free-text note when there's no fixed clock time", () => {
    expect(formatScheduleDayTime({ title: "Phase 1", timeNote: "week 1–2", items: [] })).toBe(
      "week 1–2",
    );
  });

  it("prefers the real clock time over a stray note", () => {
    expect(
      formatScheduleDayTime({
        title: "Day 1",
        startTime: "08:00",
        endTime: "17:00",
        timeNote: "ignored",
        items: [],
      }),
    ).toBe("8:00 AM – 5:00 PM");
  });

  it("is undefined when the day carries no time information at all", () => {
    expect(formatScheduleDayTime({ title: "Day 3", items: [] })).toBeUndefined();
  });

  it("ignores a malformed clock value rather than throwing", () => {
    expect(
      formatScheduleDayTime({ title: "Day 1", startTime: "not-a-time", items: [] }),
    ).toBeUndefined();
  });

  it("formats the clock in the reader's locale, not hard-coded en-US (regression)", () => {
    // A Spanish diver reads their own clock convention: 14:00, not 2:00 PM.
    expect(
      formatScheduleDayTime(
        { title: "Día 1", startTime: "08:00", endTime: "14:00", items: [] },
        "es-ES",
      ),
    ).toBe("8:00 – 14:00");
  });
});

describe("sanitizeFaqs", () => {
  it("keeps a question and its answer, trimmed", () => {
    expect(
      sanitizeFaqs([
        { question: "  Is gear included? ", answer: " Yes — full rental kit. " },
        { question: "How long is it?", answer: "Three days." },
      ]),
    ).toEqual([
      { question: "Is gear included?", answer: "Yes — full rental kit." },
      { question: "How long is it?", answer: "Three days." },
    ]);
  });

  /**
   * A pair the writer added and never filled in is not a mistake — it is the
   * row they tapped "Add a question" for and then thought better of. Same
   * contract as a blank day in `sanitizeScheduleDays`.
   */
  it("drops a pair with nothing in it", () => {
    expect(sanitizeFaqs([{ question: "  ", answer: "" }])).toEqual([]);
  });

  /**
   * A *half*-filled pair is refused, and the whole save with it. The old
   * textarea silently dropped a question nobody had answered, so the writer
   * saved, saw it gone, and had no way to tell whether it had ever been there.
   */
  it("refuses a question with no answer, and an answer with no question", () => {
    expect(sanitizeFaqs([{ question: "What about nitrox?", answer: "" }])).toBeNull();
    expect(sanitizeFaqs([{ question: "", answer: "Yes, on every boat." }])).toBeNull();
  });

  it("refuses anything that is not a list of pairs", () => {
    expect(sanitizeFaqs("Is gear included?")).toBeNull();
    expect(sanitizeFaqs([{ question: 7, answer: "Yes." }])).toBeNull();
    expect(sanitizeFaqs(null)).toBeNull();
  });

  it("refuses more questions than a course page holds", () => {
    const one = { question: "Q", answer: "A" };
    expect(sanitizeFaqs(Array.from({ length: MAX_FAQS }, () => one))).toHaveLength(MAX_FAQS);
    expect(sanitizeFaqs(Array.from({ length: MAX_FAQS + 1 }, () => one))).toBeNull();
  });
});

describe("parseLines", () => {
  it("takes one trimmed item per line", () => {
    expect(parseLines("  6 open water dives \n\nLight lunch\n")).toEqual([
      "6 open water dives",
      "Light lunch",
    ]);
  });
});

describe("splitCourseImageUrls", () => {
  it("accepts bundled paths alongside absolute links", () => {
    expect(splitCourseImageUrls("/courses/open-water.jpg\nhttps://example.com/reef.jpg")).toEqual([
      "/courses/open-water.jpg",
      "https://example.com/reef.jpg",
    ]);
  });

  it("drops a duplicate rather than showing the same photo twice", () => {
    expect(splitCourseImageUrls("/a.jpg\n/a.jpg")).toEqual(["/a.jpg"]);
  });

  it("rejects anything that is not a link", () => {
    expect(() => splitCourseImageUrls("open-water.jpg")).toThrow();
    expect(() => splitCourseImageUrls("javascript:alert(1)")).toThrow();
  });

  it("caps the gallery", () => {
    const many = Array.from({ length: 9 }, (_, index) => `/course-${index}.jpg`).join("\n");
    expect(() => splitCourseImageUrls(many)).toThrow();
  });
});

describe("courseTotalCents", () => {
  it("asks for one payment covering both lines", () => {
    expect(courseTotalCents(openWater)).toBe(70900);
  });

  it("drops to the instruction fee alone when the student brings their own e-learning", () => {
    expect(courseTotalCents({ ...openWater, eLearningPriceCents: null })).toBe(49900);
  });

  it("reports an unpriced course as unpriced, not as free", () => {
    expect(
      courseTotalCents({ ...openWater, priceCents: null, eLearningPriceCents: null }),
    ).toBeNull();
  });
});

describe("course depth placeholders", () => {
  const meters: CourseDepthFormat = {
    unit: "meters",
    withUnit: (value) => `${value} meters`,
  };
  const feet: CourseDepthFormat = {
    unit: "feet",
    withUnit: (value) => `${value} feet`,
  };

  it("resolves a marker into the shop's own unit", () => {
    expect(resolveCourseDepths("No deeper than {depth12}.", meters)).toBe(
      "No deeper than 12 meters.",
    );
    expect(resolveCourseDepths("No deeper than {depth12}.", feet)).toBe("No deeper than 40 feet.");
  });

  it("looks the pair up rather than converting it", () => {
    // depthInUnit(18, "feet") is 59 — a number that appears in no dive manual
    // anywhere, and the exact bug DepthCeiling exists to prevent.
    expect(resolveCourseDepths("{depth18}", feet)).toBe("60 feet");
    expect(resolveCourseDepths("{depth40}", feet)).toBe("130 feet");
  });

  it("carries the recreational standards, each half a real published figure", () => {
    // The same five pairs `DepthCeiling` (src/lib/depth-ceiling.ts) holds, so a
    // course page and a roster warning can never quote different limits. Each
    // is checked as a *pair*, not a conversion: the feet figure typed by a
    // Florida shop must read back as itself, which is what makes 60 the
    // partner of 18 rather than 59.
    expect(COURSE_DEPTHS).toEqual([
      { meters: 12, feet: 40 },
      { meters: 18, feet: 60 },
      { meters: 21, feet: 70 },
      { meters: 30, feet: 100 },
      { meters: 40, feet: 130 },
    ]);
    for (const depth of COURSE_DEPTHS) {
      expect(depthInUnit(feetToMeters(depth.feet), "feet")).toBe(depth.feet);
      expect(Math.abs(metersToFeet(depth.meters) - depth.feet)).toBeLessThan(2);
    }
  });

  it("writes the bare number for a range", () => {
    expect(resolveCourseDepths("to {depth30n}–{depth40}", feet)).toBe("to 100–130 feet");
    expect(resolveCourseDepths("to {depth30n}–{depth40}", meters)).toBe("to 30–40 meters");
  });

  it("leaves a broken marker exactly as the shop typed it, never throwing", () => {
    // The deliberate failure mode: visible, inert, and reported by
    // courseDepthPlaceholderIssues — never an exception mid-render, and never
    // an ICU error the translators would swallow into an empty paragraph.
    for (const broken of ["{depth 18}", "{Depth18}", "{depth19}", "{depth18", "depth18}", "{}"]) {
      expect(resolveCourseDepths(`Dive to ${broken} today.`, feet)).toBe(
        `Dive to ${broken} today.`,
      );
    }
  });

  it("leaves ICU-hostile prose alone", () => {
    // Shop prose never goes through MessageFormat, so an apostrophe, a #, or a
    // brace that means nothing to us survives untouched.
    const prose = "Nobody's graded — bring #1 priority: fun {see the briefing}.";
    expect(resolveCourseDepths(prose, feet)).toBe(prose);
  });

  it("refuses a broken marker but not a deleted one", () => {
    expect(courseDepthPlaceholderIssues("No deeper than 40 feet.")).toEqual([]);
    expect(courseDepthPlaceholderIssues("No deeper than {depth12}.")).toEqual([]);
    expect(courseDepthPlaceholderIssues("No deeper than {depth 12}.")).toEqual([
      { token: "{depth 12}", reason: "malformed" },
    ]);
    expect(courseDepthPlaceholderIssues("{Depth12}")).toEqual([
      { token: "{Depth12}", reason: "malformed" },
    ]);
    // Well-formed, but not a standard the agencies publish — refused rather
    // than silently converted to "62 ft".
    expect(courseDepthPlaceholderIssues("{depth19}")).toEqual([
      { token: "{depth19}", reason: "unknown" },
    ]);
  });

  it("catches a brace lost in either direction", () => {
    expect(courseDepthPlaceholderIssues("Dive to {depth18 with your instructor")).toEqual([
      { token: "{depth18 wit", reason: "malformed" },
    ]);
    expect(courseDepthPlaceholderIssues("Dive to depth18} with your instructor")).toEqual([
      { token: "depth18}", reason: "malformed" },
    ]);
  });

  it("ignores braces that are not aiming at a depth", () => {
    expect(courseDepthPlaceholderIssues("Bring {mask, fins, snorkel}.")).toEqual([]);
  });

  it("resolves every prose field of a course, so a new field cannot opt out", () => {
    const content: CourseContent = {
      summary: "Dive to {depth18}",
      overview: "Dive to {depth18}",
      heroImageUrl: null,
      heroImageAlt: null,
      galleryPhotos: [],
      durationText: "{depth18}",
      groupSizeText: "{depth18}",
      minimumAge: 10,
      prerequisiteNote: "{depth18}",
      includes: ["{depth18}"],
      excludes: ["{depth18}"],
      scheduleDays: [{ title: "{depth18}", items: ["{depth18}"] }],
      faqs: [{ question: "{depth18}", answer: "{depth18}" }],
      isIntroCourse: false,
    };
    const resolved = resolveCourseContentDepths(content, feet);
    const rendered = JSON.stringify(resolved);
    expect(rendered).not.toContain("{depth");
    expect(resolved.scheduleDays[0].items[0]).toBe("60 feet");
    expect(resolved.faqs[0].answer).toBe("60 feet");
    // Untouched fields survive the pass.
    expect(resolved.minimumAge).toBe(10);
  });

  it("resolves the staff-picker blurb too, since JSON-LD falls back to it", () => {
    const row = { ...blankContent, description: "Four dives to {depth40}." };
    expect(resolveCourseContentDepths(row, feet).description).toBe("Four dives to 130 feet.");
  });
});
