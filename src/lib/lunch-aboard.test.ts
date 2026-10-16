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
      answered: 2,
      asked: 3,
    });
  });

  it("counts who left a note, so an empty list never reads as nobody having a restriction", () => {
    const quiet = [{ fullName: "Tom Okafor", dietaryNote: null }];
    expect(
      lunchSummary({ lunchAboard: true, cancelled: false, seats: quiet, crewAboard: 0 }),
    ).toMatchObject({ notes: [], answered: 0, asked: 1 });
  });

  it("says nothing when lunch is not aboard, or the boat is not going", () => {
    expect(lunchSummary({ lunchAboard: false, cancelled: false, seats, crewAboard: 2 })).toBeNull();
    expect(lunchSummary({ lunchAboard: true, cancelled: true, seats, crewAboard: 2 })).toBeNull();
  });
});
