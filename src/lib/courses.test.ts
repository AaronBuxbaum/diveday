import { describe, expect, it } from "vitest";
import {
  bookingInvoiceLines,
  courseCharges,
  courseSlug,
  courseTotalCents,
  formatFaqs,
  formatScheduleDays,
  parseFaqs,
  parseLines,
  parseScheduleDays,
  splitCourseImageUrls,
} from "./courses";

const openWater = {
  title: "Open Water Diver",
  priceCents: 49900,
  eLearningPriceCents: 21000,
};

describe("courseCharges", () => {
  it("invoices instruction and e-learning as separate lines", () => {
    expect(courseCharges(openWater)).toEqual([
      {
        kind: "course_fee",
        description: "Open Water Diver — instruction",
        amountCents: 49900,
      },
      {
        kind: "e_learning_fee",
        description: "Open Water Diver — e-learning",
        amountCents: 21000,
      },
    ]);
  });

  it("omits an unpriced item rather than invoicing a zero line", () => {
    expect(courseCharges({ ...openWater, eLearningPriceCents: null })).toEqual([
      {
        kind: "course_fee",
        description: "Open Water Diver — instruction",
        amountCents: 49900,
      },
    ]);
    expect(courseCharges({ ...openWater, priceCents: null })).toEqual([
      {
        kind: "e_learning_fee",
        description: "Open Water Diver — e-learning",
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
      { kind: "course_fee", description: "Open Water Diver — instruction", amountCents: 49900 },
      { kind: "e_learning_fee", description: "Open Water Diver — e-learning", amountCents: 21000 },
    ]);
  });

  it("falls back to the session's own price when the catalog entry is unpriced", () => {
    expect(bookingInvoiceLines({ trip, course: { ...openWater, priceCents: null } })).toEqual([
      { kind: "course_fee", description: "Open Water Diver — instruction", amountCents: 30000 },
      { kind: "e_learning_fee", description: "Open Water Diver — e-learning", amountCents: 21000 },
    ]);
  });

  it("bills an ordinary charter as one trip fee", () => {
    expect(bookingInvoiceLines({ trip, course: null })).toEqual([
      { kind: "trip_fee", description: "Open Water — July weekend", amountCents: 30000 },
    ]);
  });

  it("leaves the amount blank rather than guessing when nothing is priced", () => {
    expect(
      bookingInvoiceLines({
        trip: { title: "Shore dive", priceCents: null },
        course: { title: "Open Water Diver", priceCents: null, eLearningPriceCents: null },
      }),
    ).toEqual([{ kind: "trip_fee", description: "Shore dive", amountCents: null }]);
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

describe("parseScheduleDays", () => {
  it("reads a blank-line-separated day plan", () => {
    expect(
      parseScheduleDays(
        "Day 1 — 8:15am–5:30pm\nAcademics 1–2\nConfined water\n\nDay 2 — 8:00am–4:00pm\nOpen water dives 3–4",
      ),
    ).toEqual([
      { title: "Day 1", timeRange: "8:15am–5:30pm", items: ["Academics 1–2", "Confined water"] },
      { title: "Day 2", timeRange: "8:00am–4:00pm", items: ["Open water dives 3–4"] },
    ]);
  });

  it("splits on the last separator so a dash inside the title survives", () => {
    expect(parseScheduleDays("Day 2 — Confined water — 9am–noon\nPool skills")).toEqual([
      { title: "Day 2 — Confined water", timeRange: "9am–noon", items: ["Pool skills"] },
    ]);
  });

  it("keeps a day with no time range and no items", () => {
    expect(parseScheduleDays("Day 3")).toEqual([{ title: "Day 3", items: [] }]);
  });

  it("ignores blank blocks and stray whitespace", () => {
    expect(parseScheduleDays("\n\n  Day 1  \n  Academics  \n\n\n  \n\n")).toEqual([
      { title: "Day 1", items: ["Academics"] },
    ]);
  });

  it("round-trips through the textarea encoding", () => {
    const days = [
      { title: "Day 1", timeRange: "8:15am–5:30pm", items: ["Academics", "Dives 1–2"] },
      { title: "Day 2", items: ["Exam"] },
    ];
    expect(parseScheduleDays(formatScheduleDays(days))).toEqual(days);
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
