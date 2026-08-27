import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  hasSupportNeeds,
  type SupportNeeds,
  supportNeedFacts,
  totalSupportDiversNeeded,
} from "./support-needs";

const NOTHING: SupportNeeds = {
  supportDiversNeeded: null,
  needsBoardingAssistance: false,
  needsWaterEntryLift: false,
  briefingInSign: false,
  briefingInWriting: false,
  briefingBySignals: false,
  equipmentAdaptation: null,
  divesWithName: null,
};

describe("support needs", () => {
  it("treats a diver nobody asked and a diver who needs nothing as the same on a crew surface", () => {
    // Both render nothing, which is the point: a line saying "no support
    // needed" beside a name is the absence of information formatted as
    // information (design principle 9). The two are still *different facts* —
    // `stated_at` is what tells them apart — and this is only about what a
    // manifest prints.
    expect(hasSupportNeeds(null)).toBe(false);
    expect(hasSupportNeeds(NOTHING)).toBe(false);
    expect(hasSupportNeeds({ ...NOTHING, supportDiversNeeded: 0 })).toBe(false);
    expect(supportNeedFacts({ ...NOTHING, supportDiversNeeded: 0 })).toEqual([]);
  });

  it("reads a stated need as something to plan around", () => {
    expect(hasSupportNeeds({ ...NOTHING, supportDiversNeeded: 1 })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, needsWaterEntryLift: true })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, briefingInSign: true })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, equipmentAdaptation: "webbed gloves" })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, divesWithName: "Marisol Vega" })).toBe(true);
    // Whitespace is not an answer — the writer trims, and a reader that did not
    // would print an empty bullet on a manifest.
    expect(hasSupportNeeds({ ...NOTHING, equipmentAdaptation: "   " })).toBe(false);
    expect(hasSupportNeeds({ ...NOTHING, divesWithName: "  " })).toBe(false);
  });

  it("lists the facts in the order the day runs", () => {
    expect(
      supportNeedFacts({
        supportDiversNeeded: 2,
        needsBoardingAssistance: true,
        needsWaterEntryLift: true,
        briefingInSign: false,
        briefingInWriting: true,
        briefingBySignals: true,
        equipmentAdaptation: "  webbed gloves  ",
        divesWithName: "  Marisol Vega  ",
      }),
    ).toEqual([
      { kind: "support_divers", count: 2 },
      { kind: "boarding_assistance" },
      { kind: "water_entry_lift" },
      { kind: "briefing_written" },
      { kind: "briefing_signals" },
      { kind: "equipment", note: "webbed gloves" },
      { kind: "dives_with", name: "Marisol Vega" },
    ]);
  });

  it("sums a departure's support requirement over its whole roster", () => {
    expect(
      totalSupportDiversNeeded([
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 2 } },
        // Asked, needs nobody.
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 0 } },
        // Never asked.
        { supportNeeds: null },
        {},
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 1 } },
      ]),
    ).toBe(3);
    expect(totalSupportDiversNeeded([])).toBe(0);
  });

  /**
   * **The first refusal, tested as a negative because it is the one that fails
   * silently.**
   *
   * "It never gates" (ADR 20260827-support-needs-are-a-record-about-the-dive) is
   * provable at the source: a gate added later by accident is otherwise
   * invisible until a diver is refused a seat, which is precisely the outcome
   * adaptive divers already get everywhere else and the reason this record
   * exists at all.
   *
   * Reading the files rather than exercising the engines is deliberate. An
   * output comparison proves the two engines ignore the record *today*, for the
   * inputs the test happened to think of; an import check proves they cannot
   * read it at all, which is the property the ADR actually promises.
   * `src/lib/course-ratios.ts` is in the list for the stronger reason: those are
   * agency caps that really do refuse a seat in `createBookingRecord`, and no
   * diver's support needs may ever move one.
   */
  it("is unreachable from anything that can refuse a diver", () => {
    for (const gate of ["readiness.ts", "trip-admission.ts", "course-ratios.ts"]) {
      expect(readFileSync(`src/lib/${gate}`, "utf8")).not.toContain("support-needs");
    }
  });
});
