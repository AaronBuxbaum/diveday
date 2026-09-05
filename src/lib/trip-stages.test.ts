import { describe, expect, it } from "vitest";
import {
  liveStageOf,
  STAGE_SENTENCE_KEYS,
  STAGE_TAP_KEYS,
  STAGE_WORD_KEYS,
  stageIsPublishable,
  stageTone,
  TRIP_STAGES,
  type TripStageReading,
} from "./trip-stages";

const reading = (recordedAt: string): TripStageReading => ({
  stage: "underway",
  siteName: "Molasses Reef",
  recordedAt: new Date(recordedAt),
  recordedByName: "Keiko Tanaka",
});

describe("liveStageOf", () => {
  const endsAt = new Date("2026-07-21T15:00:00.000Z");

  it("says nothing when the crew has tapped nothing", () => {
    expect(liveStageOf(null, endsAt, new Date("2026-07-21T13:00:00.000Z"))).toBeNull();
  });

  it("speaks while the departure is running", () => {
    expect(
      liveStageOf(
        reading("2026-07-21T12:10:00.000Z"),
        endsAt,
        new Date("2026-07-21T13:00:00.000Z"),
      ),
    ).toMatchObject({ stage: "underway" });
  });

  it("still speaks for a boat that is genuinely late", () => {
    // An hour and a half past the scheduled end, which is when the line is
    // worth the most rather than the least.
    expect(
      liveStageOf(
        reading("2026-07-21T12:10:00.000Z"),
        endsAt,
        new Date("2026-07-21T16:30:00.000Z"),
      ),
    ).toMatchObject({ stage: "underway" });
  });

  it("stops speaking once the boat's own day is over", () => {
    expect(
      liveStageOf(
        reading("2026-07-21T12:10:00.000Z"),
        endsAt,
        new Date("2026-07-22T02:00:00.000Z"),
      ),
    ).toBeNull();
  });

  it("keeps a stage on a departure with no end to measure from", () => {
    expect(
      liveStageOf(reading("2026-07-21T12:10:00.000Z"), null, new Date("2026-07-25T02:00:00.000Z")),
    ).toMatchObject({ stage: "underway" });
  });
});

describe("the five stages", () => {
  it("are the five the owner chose, in the order the crew taps them", () => {
    expect(TRIP_STAGES).toEqual(["boarding", "underway", "surface", "heading_in", "home"]);
  });

  it("gives every stage a word, a tap and a sentence", () => {
    for (const stage of TRIP_STAGES) {
      expect(STAGE_WORD_KEYS[stage]).toBeTruthy();
      expect(STAGE_TAP_KEYS[stage]).toBeTruthy();
      expect(STAGE_SENTENCE_KEYS[stage]).toBeTruthy();
    }
  });

  it("names no key that could render the word this app refuses to say", () => {
    // A stage nobody set is absent, never "Unknown" — so no key exists for it.
    const keys = [
      ...Object.values(STAGE_WORD_KEYS),
      ...Object.values(STAGE_TAP_KEYS),
      ...Object.values(STAGE_SENTENCE_KEYS),
    ].join(" ");
    expect(keys.toLowerCase()).not.toContain("unknown");
  });

  it("gives the success tone to home and to nothing else", () => {
    expect(stageTone("home")).toBe("success");
    for (const stage of TRIP_STAGES.filter((s) => s !== "home")) {
      expect(stageTone(stage)).toBe("primary");
    }
  });

  it("publishes every stage but home", () => {
    expect(stageIsPublishable("home")).toBe(false);
    for (const stage of TRIP_STAGES.filter((s) => s !== "home")) {
      expect(stageIsPublishable(stage)).toBe(true);
    }
  });
});
