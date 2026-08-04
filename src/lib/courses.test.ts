import { describe, expect, it } from "vitest";
import {
  bookingInvoiceLines,
  courseCharges,
  courseSlug,
  courseTotalCents,
  formatFaqs,
  formatScheduleDayTime,
  MAX_PATH_STEPS,
  parseFaqs,
  parseLines,
  sanitizePathSteps,
  splitCourseImageUrls,
} from "./courses";

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

describe("parseFaqs", () => {
  it("reads question-then-answer blocks", () => {
    expect(
      parseFaqs("Is gear included?\nYes — full rental kit.\n\nHow long is it?\nThree days."),
    ).toEqual([
      { question: "Is gear included?", answer: "Yes — full rental kit." },
      { question: "How long is it?", answer: "Three days." },
    ]);
  });

  it("joins a multi-line answer into one paragraph", () => {
    expect(parseFaqs("What will I learn?\nBuoyancy.\nNavigation.")).toEqual([
      { question: "What will I learn?", answer: "Buoyancy. Navigation." },
    ]);
  });

  it("drops a question nobody answered rather than rendering an empty accordion", () => {
    expect(parseFaqs("What about nitrox?")).toEqual([]);
  });

  it("round-trips through the textarea encoding", () => {
    const faqs = [{ question: "Is gear included?", answer: "Yes." }];
    expect(parseFaqs(formatFaqs(faqs))).toEqual(faqs);
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

describe("sanitizePathSteps", () => {
  const openWaterId = "11111111-1111-4111-8111-111111111111";
  const rescueId = "22222222-2222-4222-8222-222222222222";

  it("keeps the shop's order and trims each note", () => {
    expect(
      sanitizePathSteps([
        { courseId: rescueId, note: "  after a season  " },
        { courseId: openWaterId },
      ]),
    ).toEqual([
      { courseId: rescueId, note: "after a season" },
      { courseId: openWaterId, note: "" },
    ]);
  });

  it("collapses a course the builder listed twice", () => {
    expect(sanitizePathSteps([{ courseId: openWaterId }, { courseId: openWaterId }])).toEqual([
      { courseId: openWaterId, note: "" },
    ]);
  });

  it("accepts an empty path — a shop may clear its rungs and keep the path", () => {
    expect(sanitizePathSteps([])).toEqual([]);
  });

  it("refuses anything that is not a list of steps", () => {
    expect(sanitizePathSteps(null)).toBeNull();
    expect(sanitizePathSteps({ courseId: openWaterId })).toBeNull();
    expect(sanitizePathSteps([{ courseId: "not-a-uuid" }])).toBeNull();
  });

  it("refuses more rungs than the server will store", () => {
    const tooMany = Array.from({ length: MAX_PATH_STEPS + 1 }, (_, index) => ({
      courseId: `3333333${index % 10}-3333-4333-8333-333333333333`,
    }));
    expect(sanitizePathSteps(tooMany)).toBeNull();
  });
});
