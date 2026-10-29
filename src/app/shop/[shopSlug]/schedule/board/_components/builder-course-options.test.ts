import { describe, expect, it } from "vitest";
import { builderCourseOptions, builderCoursePriceLabel } from "./builder-course-options";

describe("course prices in the schedule builder", () => {
  it("shows the same per-diver total checkout charges, including eLearning", () => {
    const course = {
      id: "course-1",
      title: "Open Water",
      agency: "padi",
      priceCents: 54_900,
      eLearningPriceCents: 16_000,
    };

    expect(builderCoursePriceLabel(course, { currency: "USD" }, "en-US")).toBe(
      "$709.00 per diver, the course’s price",
    );
    expect(builderCourseOptions([course], { currency: "USD" }, "en-US")[0]?.priceLabel).toBe(
      "$709.00 per diver, the course’s price",
    );
  });

  it("leaves an unpriced course available for a trip-fee fallback", () => {
    expect(
      builderCoursePriceLabel(
        { title: "Unpriced", priceCents: null, eLearningPriceCents: 16_000 },
        { currency: "USD" },
        "en-US",
      ),
    ).toBeNull();
  });
});
