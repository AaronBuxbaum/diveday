import { describe, expect, it } from "vitest";
import { bookingInvoiceLines, courseCharges, courseTotalCents } from "./courses";

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
