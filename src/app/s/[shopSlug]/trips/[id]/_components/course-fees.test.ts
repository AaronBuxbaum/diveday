import { describe, expect, it } from "vitest";
import { bookingCourseFees } from "./course-fees";

describe("bookingCourseFees", () => {
  it("states nothing for a departure that is no course session", () => {
    expect(bookingCourseFees({ priceCents: 12000, course: null } as never)).toEqual({
      courseFeeCents: null,
      eLearningFeeCents: null,
    });
  });

  it("falls back to the departure's price when the course names none", () => {
    const fees = bookingCourseFees({
      priceCents: 45000,
      course: { title: "Open Water", priceCents: null, eLearningPriceCents: 20000 },
    } as never);
    expect(fees.eLearningFeeCents).toBe(20000);
    expect(fees.courseFeeCents).not.toBeNull();
  });
});
