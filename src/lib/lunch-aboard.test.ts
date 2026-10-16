import { describe, expect, it } from "vitest";
import { cleanDietaryNote, DIETARY_NOTE_MAX, lunchSummary } from "./lunch-aboard";

describe("cleanDietaryNote", () => {
  it("trims, collapses and bounds a note, and reads blank as none", () => {
    expect(cleanDietaryNote("  no   shellfish ")).toBe("no shellfish");
    expect(cleanDietaryNote("   ")).toBeNull();
    expect(cleanDietaryNote(null)).toBeNull();
    expect(cleanDietaryNote("x".repeat(400))?.length).toBe(DIETARY_NOTE_MAX);
  });
});

describe("lunchSummary", () => {
  const seats = [
    { fullName: "Ines Costa", dietaryNote: "no shellfish" },
    { fullName: "Tom Okafor", dietaryNote: null },
    { fullName: "Priya Sharma", dietaryNote: " vegetarian " },
  ];

  it("feeds every seat and the crew, and names what each can't eat", () => {
    expect(lunchSummary({ lunchAboard: true, cancelled: false, seats, crewAboard: 2 })).toEqual({
      count: 5,
      notes: [
        { name: "Ines Costa", note: "no shellfish" },
        { name: "Priya Sharma", note: "vegetarian" },
      ],
    });
  });

  it("says nothing when lunch is not aboard, or the boat is not going", () => {
    expect(lunchSummary({ lunchAboard: false, cancelled: false, seats, crewAboard: 2 })).toBeNull();
    expect(lunchSummary({ lunchAboard: true, cancelled: true, seats, crewAboard: 2 })).toBeNull();
  });
});
