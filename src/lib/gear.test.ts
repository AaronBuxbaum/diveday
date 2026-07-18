import { describe, expect, it } from "vitest";
import { recommendGearForRoster } from "./gear";

describe("recommendGearForRoster", () => {
  it("uses each available item once and requires an exact requested size", () => {
    const recommendations = recommendGearForRoster(
      [
        {
          bookingId: "one",
          request: {
            bcd: true,
            regulator: true,
            wetsuit: false,
            maskFins: false,
            weights: false,
            tank: false,
            bcdSize: "M",
          },
          assignedTypes: [],
        },
        {
          bookingId: "two",
          request: {
            bcd: true,
            regulator: false,
            wetsuit: false,
            maskFins: false,
            weights: false,
            tank: false,
            bcdSize: "L",
          },
          assignedTypes: [],
        },
      ],
      [
        { id: "bcd-m", type: "bcd", size: "M" },
        { id: "reg", type: "regulator", size: null },
        { id: "bcd-unsized", type: "bcd", size: null },
      ],
    );

    expect(recommendations).toEqual([
      { bookingId: "one", gearItemId: "bcd-m" },
      { bookingId: "one", gearItemId: "reg" },
    ]);
  });

  it("does not replace a gear type the crew already packed", () => {
    expect(
      recommendGearForRoster(
        [
          {
            bookingId: "one",
            request: {
              bcd: true,
              regulator: false,
              wetsuit: false,
              maskFins: false,
              weights: false,
              tank: false,
            },
            assignedTypes: ["bcd"],
          },
        ],
        [{ id: "bcd-m", type: "bcd", size: "M" }],
      ),
    ).toEqual([]);
  });
});
