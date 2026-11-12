import { readFile } from "node:fs/promises";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  liveStageOf,
  STAGE_SENTENCE_KEYS,
  STAGE_WORD_KEYS,
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
  const trip = { startsAt: new Date("2026-07-21T12:00:00Z"), endsAt, timeZone: "UTC" };

  it("says nothing when the crew has tapped nothing", () => {
    expect(liveStageOf(null, trip, new Date("2026-07-21T13:00:00.000Z"))).toBeNull();
  });

  it("speaks while the departure is running", () => {
    expect(
      liveStageOf(reading("2026-07-21T12:10:00.000Z"), trip, new Date("2026-07-21T13:00:00.000Z")),
    ).toMatchObject({ stage: "underway" });
  });

  it("still speaks for a boat that is genuinely late", () => {
    // An hour and a half past the scheduled end, which is when the line is
    // worth the most rather than the least.
    expect(
      liveStageOf(reading("2026-07-21T12:10:00.000Z"), trip, new Date("2026-07-21T16:30:00.000Z")),
    ).toMatchObject({ stage: "underway" });
  });

  it("stops speaking once the boat's own day is over", () => {
    expect(
      liveStageOf(reading("2026-07-21T12:10:00.000Z"), trip, new Date("2026-07-22T02:00:00.000Z")),
    ).toBeNull();
  });

  it("keeps a stage on a departure with no end to measure from", () => {
    expect(
      liveStageOf(
        reading("2026-07-21T12:10:00.000Z"),
        { ...trip, endsAt: null },
        new Date("2026-07-25T02:00:00.000Z"),
      ),
    ).toMatchObject({ stage: "underway" });
  });
});

describe("the five stages", () => {
  it("are the five the owner chose, in the order the crew taps them", () => {
    expect(TRIP_STAGES).toEqual(["boarding", "underway", "surface", "heading_in", "home"]);
  });

  it("gives every stage a word and a sentence", () => {
    for (const stage of TRIP_STAGES) {
      expect(STAGE_WORD_KEYS[stage]).toBeTruthy();
      expect(STAGE_SENTENCE_KEYS[stage]).toBeTruthy();
    }
  });

  it("names no key that could render the word this app refuses to say", () => {
    // A stage nobody set is absent, never "Unknown" — so no key exists for it.
    const keys = [...Object.values(STAGE_WORD_KEYS), ...Object.values(STAGE_SENTENCE_KEYS)].join(
      " ",
    );
    expect(keys.toLowerCase()).not.toContain("unknown");
  });
});

/**
 * A stage was a display word — five taps DiveDay repeated on four surfaces —
 * until the close-out started reading one (issue #1480): a live `home` is now
 * part of whether a day may close. A word the day's end depends on is a domain
 * concept, and AGENTS.md gives a new domain concept a glossary entry; this one
 * had two passing mentions and no definition (`dive-domain-expert`, the RFH-07
 * layer).
 *
 * A text scan, in the spirit of `src/lib/gear.test.ts`'s register-group entry:
 * it cannot judge prose and does not try. It fails when the entry is gone or
 * has been rewritten past the rules it exists to carry.
 */
describe("the glossary's trip-stage entry", () => {
  const entry = async () => {
    const glossary = await readFile(
      path.join(process.cwd(), "docs/product/glossary/operations.md"),
      "utf8",
    );
    const block = glossary.split(/^- \*\*/m).find((part) => part.startsWith("Trip stage**"));
    expect(block, "docs/product/glossary/operations.md has no **Trip stage** entry").toBeDefined();
    return block ?? "";
  };

  it("names all five words and who records one", async () => {
    const text = await entry();
    for (const stage of TRIP_STAGES) {
      expect(text).toContain(`\`${stage}\``);
    }
    expect(text).toContain("recordTripStage");
    expect(text).toMatch(/active\s+staff member/);
  });

  it("carries the two rules a reader could otherwise invert", async () => {
    const text = await entry();
    // Never inferred: a clock does not produce a stage, and an absent one is
    // absent rather than "Unknown".
    expect(text).toMatch(/Never inferred/);
    expect(text).toContain('"Unknown"');
    // Final-day Home can settle early; a speaking non-home word keeps the
    // boat out when overdue. An earlier course day's Home finishes nothing.
    expect(text).toContain("#1480");
    expect(text).toMatch(/final-meeting-day `home` can settle a counted station/);
    expect(text).toMatch(/non-home stage keeps it out even when overdue/);
    expect(text).toMatch(/Earlier-day course Home\s+finishes nothing/);
  });

  it("says a stale stage is silence rather than a contradiction", async () => {
    const text = await entry();
    expect(text).toContain("`stage_stale` rung");
    expect(text).toMatch(/stale\s+rather than wrong/);
    expect(text).toMatch(/expired staff word hands the question back to the clock/);
  });
});

describe("public stage day boundaries", () => {
  const trip = {
    startsAt: new Date("2026-10-10T13:00:00Z"),
    endsAt: new Date("2026-10-10T18:00:00Z"),
    timeZone: "America/New_York",
  };
  it("does not publish a tap from the previous shop day, even on the same UTC date", () => {
    expect(
      liveStageOf(reading("2026-10-10T03:59:59Z"), trip, new Date("2026-10-10T13:00:00Z")),
    ).toBeNull();
  });
  it("accepts midnight and keeps the word through the exact late buffer", () => {
    const tap = reading("2026-10-10T04:00:00Z");
    expect(liveStageOf(tap, trip, new Date("2026-10-10T20:00:00Z"))).toBe(tap);
    expect(liveStageOf(tap, trip, new Date("2026-10-10T20:00:00.001Z"))).toBeNull();
  });
  it("does not carry a prior meeting into the next meeting or the gap", () => {
    const run = {
      ...trip,
      endsAt: new Date("2026-10-13T18:00:00Z"),
      meetingWindows: [
        { startsAt: trip.startsAt, endsAt: trip.endsAt },
        { startsAt: new Date("2026-10-13T13:00:00Z"), endsAt: new Date("2026-10-13T18:00:00Z") },
      ],
    };
    const tap = reading("2026-10-10T14:00:00Z");
    expect(liveStageOf(tap, run, new Date("2026-10-11T12:00:00Z"))).toBeNull();
    expect(liveStageOf(tap, run, new Date("2026-10-13T13:00:00Z"))).toBeNull();
    expect(
      liveStageOf(reading("2026-10-13T13:00:00Z"), run, new Date("2026-10-13T14:00:00Z")),
    ).not.toBeNull();
  });
  it("keeps a midnight-crossing meeting's tap into its next local day", () => {
    const run = {
      startsAt: new Date("2026-10-10T02:00:00Z"),
      endsAt: new Date("2026-10-13T06:00:00Z"),
      timeZone: "America/New_York",
      meetingWindows: [
        { startsAt: new Date("2026-10-10T02:00:00Z"), endsAt: new Date("2026-10-10T06:00:00Z") },
        { startsAt: new Date("2026-10-13T02:00:00Z"), endsAt: new Date("2026-10-13T06:00:00Z") },
      ],
    };
    const tap = reading("2026-10-10T03:30:00Z");
    expect(liveStageOf(tap, run, new Date("2026-10-10T05:00:00Z"))).toBe(tap);
    expect(liveStageOf(tap, run, new Date("2026-10-10T06:00:00Z"))).toBeNull();
  });
});
