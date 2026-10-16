import { describe, expect, it } from "vitest";
import { courseEndedBefore, inTrainingBefore } from "./in-training";

describe("inTrainingBefore", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");
  const trip = { id: "fun", startsAt: new Date("2026-10-10T13:00:00.000Z") };
  const seat = (finishesAt: string, tripId = "course") => ({
    personId: "p",
    tripId,
    level: "open_water" as const,
    finishesAt: new Date(finishesAt),
  });

  it("counts a course that is still ahead and ends before the trip", () => {
    expect(inTrainingBefore([seat("2026-10-09T17:00:00.000Z")], trip, now)).toHaveLength(1);
  });

  it("stops counting a course that has already ended, at the sale as at the rail", () => {
    // A student who sat two days in May and quit is not in training in October.
    expect(inTrainingBefore([seat("2026-05-12T17:00:00.000Z")], trip, now)).toEqual([]);
  });

  it("ignores a course that ends after the trip, and the trip itself", () => {
    expect(
      inTrainingBefore(
        [seat("2026-10-11T17:00:00.000Z"), seat("2026-10-09T17:00:00.000Z", "fun")],
        trip,
        now,
      ),
    ).toEqual([]);
  });
});

describe("courseEndedBefore", () => {
  const now = new Date("2026-10-04T12:00:00.000Z");
  const trip = { id: "fun", startsAt: new Date("2026-10-10T13:00:00.000Z") };
  const seat = (finishesAt: string, tripId = "course") => ({
    personId: "p",
    tripId,
    level: "open_water" as const,
    finishesAt: new Date(finishesAt),
  });

  it("is exactly the course seats the training window has let go", () => {
    const over = seat("2026-10-01T17:00:00.000Z");
    const ahead = seat("2026-10-09T17:00:00.000Z");
    expect(courseEndedBefore([over, ahead], trip, now)).toEqual([over]);
    expect(inTrainingBefore([over, ahead], trip, now)).toHaveLength(1);
  });

  it("ignores the trip itself and a course that ends after it", () => {
    expect(
      courseEndedBefore(
        [seat("2026-10-01T17:00:00.000Z", "fun"), seat("2026-10-11T17:00:00.000Z")],
        { id: "fun", startsAt: new Date("2026-10-10T13:00:00.000Z") },
        new Date("2026-10-12T12:00:00.000Z"),
      ),
    ).toEqual([]);
  });
});
