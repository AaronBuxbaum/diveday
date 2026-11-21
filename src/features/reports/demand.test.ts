import { describe, expect, it } from "vitest";
import { demandRecommendation } from "./demand";

describe("demandRecommendation", () => {
  it("recommends more capacity when a full trip has a meaningful wait list", () => {
    expect(demandRecommendation({ capacity: 8, booked: 8, waitlisted: 2 })?.unmetSeats).toBe(2);
  });

  it("stays quiet before both demand signals cross the threshold", () => {
    expect(demandRecommendation({ capacity: 8, booked: 7, waitlisted: 4 })).toBeNull();
    expect(demandRecommendation({ capacity: 12, booked: 12, waitlisted: 2 })).toBeNull();
  });
});
