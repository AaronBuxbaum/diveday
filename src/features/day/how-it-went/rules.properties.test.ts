/**
 * Properties of How it went (src/features/day/how-it-went/rules.ts): a head count says only
 * what its results say, and nothing is "sorted before boarding" that happened
 * off the departure's date or after the diver was counted aboard. Example
 * tests: how-it-went.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import type { IncidentRollCallResult, IncidentRosterEntry } from "@/lib/incident-export";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import { property } from "@/test/property";
import { howItWent } from "./rules";

const DAY = { from: new Date("2026-11-28T05:00:00Z"), to: new Date("2026-11-29T05:00:00Z") };
const CHECKPOINTS: RollCallCheckpoint[] = ["departure", "after_dive_1", "after_dive_2"];
const HOUR = 60 * 60 * 1000;

const arbInstant = fc
  .integer({ min: -36 * HOUR, max: 60 * HOUR })
  .map((offset) => new Date(DAY.from.getTime() + offset).toISOString());
const arbLabel = fc.constantFrom<IncidentRollCallResult["label"]>(
  "awaiting",
  "boarded",
  "not_boarded",
  "not_boarded_carried",
  "not_back_aboard",
);
const arbResults = fc
  .tuple(...CHECKPOINTS.map(() => fc.tuple(arbLabel, arbInstant)))
  .map((rows): IncidentRollCallResult[] =>
    rows.map(([label, at], index) => ({
      checkpoint: CHECKPOINTS[index] as RollCallCheckpoint,
      label,
      occurredAt: label === "awaiting" ? null : at,
      recordedByName: label === "awaiting" ? null : "Sam",
    })),
  );
const arbDiver = fc.record({
  rollCall: arbResults,
  signedAt: fc.option(arbInstant),
  fitAt: fc.option(arbInstant),
});
const arbRoster = fc.array(arbDiver, { maxLength: 12 }).map((rows) =>
  rows.map((row, index) => ({
    entry: {
      bookingId: `b-${index}`,
      fullName: `Diver ${index}`,
      emergencyContactName: null,
      emergencyContactPhone: null,
      buddy: null,
      rollCall: row.rollCall,
      certifications: [],
      certificationsStartedAt: null,
      certificationsCapturedAt: null,
      certificationsAtCapture: null,
      waiver: {
        state: row.signedAt ? "complete" : "awaiting_signature",
        signedAt: row.signedAt,
      },
    } as unknown as IncidentRosterEntry,
    fitAt: row.fitAt,
  })),
);

function recapOf(roster: { entry: IncidentRosterEntry; fitAt: string | null }[]) {
  return howItWent({
    checkpoints: CHECKPOINTS,
    roster: roster.map(({ entry }) => entry),
    crew: [],
    turnedAway: [],
    executedDives: [],
    countedAboardBlocked: new Map(),
    fitStatedAt: new Map(
      roster.map(({ entry, fitAt }) => [entry.bookingId, fitAt ? new Date(fitAt) : null]),
    ),
    day: DAY,
  });
}

describe("How it went", () => {
  property("a count's aboard is exactly the people it recorded boarded", [arbRoster], (roster) => {
    const recap = recapOf(roster);
    recap.counts.forEach((count, index) => {
      const labels = roster.map(({ entry }) => entry.rollCall[index]?.label);
      expect(count.aboard).toBe(labels.filter((label) => label === "boarded").length);
      expect(count.notBack.length).toBe(labels.filter((l) => l === "not_back_aboard").length);
      expect(count.taken).toBe(labels.some((label) => label !== "awaiting"));
    });
  });

  property(
    "a count nobody took reports nobody aboard and nobody missing",
    [arbRoster],
    (roster) => {
      for (const count of recapOf(roster).counts) {
        if (count.taken) continue;
        expect(count.aboard).toBe(0);
        expect(count.notRecorded).toEqual([]);
        expect(count.at).toBeNull();
      }
    },
  );

  property(
    "every fix is on the departure's date and no later than the dock mark",
    [arbRoster],
    (roster) => {
      const recap = recapOf(roster);
      for (const row of recap.sorted) {
        const diver = roster.find(({ entry }) => entry.fullName === row.name)?.entry;
        const dock = diver?.rollCall.find((result) => result.checkpoint === "departure");
        expect(dock?.label).toBe("boarded");
        for (const fix of row.fixes) {
          const at = new Date(fix.at).getTime();
          expect(at).toBeGreaterThanOrEqual(DAY.from.getTime());
          expect(at).toBeLessThan(DAY.to.getTime());
          expect(at).toBeLessThanOrEqual(new Date(dock?.occurredAt ?? 0).getTime());
        }
      }
    },
  );

  property("every named diver's waiver is counted exactly once", [arbRoster], (roster) => {
    const { waivers } = recapOf(roster);
    expect(waivers.ahead + waivers.onTheDay.length + waivers.notSigned.length).toBe(roster.length);
  });
});
