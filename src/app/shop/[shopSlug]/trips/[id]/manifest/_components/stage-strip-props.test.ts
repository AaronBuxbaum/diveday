import { describe, expect, it } from "vitest";
import { staffTranslator } from "@/i18n/staff-messages";
import type { TripStageReading } from "@/lib/trip-stages";
import { tripManifest } from "./manifest-page-test-fixtures";
import { stageStripProps } from "./stage-strip-props";

const t = staffTranslator("en-US");
const trip = {
  startsAt: new Date("2026-10-10T12:00:00Z"),
  endsAt: new Date("2026-10-10T16:00:00Z"),
};
const tap = (stage: TripStageReading["stage"], at: string): TripStageReading => ({
  stage,
  siteName: null,
  recordedAt: new Date(at),
  recordedByName: "Marco",
});
const read = (stage: TripStageReading | null, now: string) =>
  stageStripProps(t, {
    trip,
    stage,
    now: new Date(now),
    timeZone: "America/New_York",
    locale: "en-US",
  });

/** The strip selects the word Today's card and the header print (UX review 2026-10-10, item 1). */
describe("stageStripProps", () => {
  it("names every tap in the one stage vocabulary", () => {
    expect(read(null, "2026-10-10T11:00:00Z").copy.taps.map((tap) => tap.label)).toEqual([
      "Boarding",
      "Underway",
      "Surface",
      "Heading in",
      "Home",
    ]);
  });

  it("selects today's tap, and keeps it while the boat is hours overdue", () => {
    const underway = tap("underway", "2026-10-10T12:30:00Z");
    expect(read(underway, "2026-10-10T20:00:00Z").current).toBe("underway");
    expect(read(underway, "2026-10-10T20:00:00Z").copy.recordedLine).toContain("Marco");
  });

  it("selects nothing for a tap left from an earlier day", () => {
    const stale = tap("home", "2026-10-09T18:00:00Z");
    const props = read(stale, "2026-10-10T11:00:00Z");
    expect(props.current).toBeNull();
    expect(props.copy.recordedLine).toBeUndefined();
  });
});

describe("stageStripProps on the way home (batch 6, item 4)", () => {
  const withLast = (awaiting: number) =>
    (["departure", "after_dive_1", "after_dive_2"] as const).map((checkpoint) =>
      tripManifest({
        trip: { ...tripManifest().trip, ...trip },
        checkpoint,
        summary: {
          ...tripManifest().summary,
          totalDivers: 4,
          awaiting: checkpoint === "after_dive_2" ? awaiting : 0,
        },
      }),
    );
  const homeward = (awaiting: number) =>
    stageStripProps(t, {
      manifests: withLast(awaiting),
      stage: tap("heading_in", "2026-10-10T15:30:00Z"),
      now: new Date("2026-10-10T15:31:00Z"),
      timeZone: "America/New_York",
      locale: "en-US",
    });

  it("words the open last roll call and points at it on this page", () => {
    expect(homeward(2).copy.rollCallOpen).toEqual({
      line: "Still 2 people not marked after dive 2.",
      openLabel: "Open roll call",
      href: "?checkpoint=after_dive_2",
    });
    // The trip is the dock manifest's: the word still selects.
    expect(homeward(2).current).toBe("heading_in");
  });

  it("carries nothing when the last roll call has everyone", () => {
    expect(homeward(0).copy.rollCallOpen).toBeUndefined();
  });
});
