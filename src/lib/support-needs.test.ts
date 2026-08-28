import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  divesWithMatch,
  hasSupportNeeds,
  type SupportNeeds,
  supportDiversToArrange,
  supportNeedFacts,
  supportNeedsAnswered,
} from "./support-needs";

const ANSWERED_AT = new Date("2026-07-20T10:00:00.000Z");

const NOTHING: SupportNeeds = {
  supportDiversNeeded: null,
  supportDiversProvidedBy: null,
  needsBoardingAssistance: false,
  needsWaterLift: false,
  briefingInSign: false,
  briefingInWriting: false,
  briefingAloud: false,
  briefingBySignals: false,
  equipmentAdaptation: null,
  divesWithName: null,
  statedAt: ANSWERED_AT,
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
    expect(hasSupportNeeds({ ...NOTHING, needsWaterLift: true })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, briefingInSign: true })).toBe(true);
    expect(hasSupportNeeds({ ...NOTHING, briefingAloud: true })).toBe(true);
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
        ...NOTHING,
        supportDiversNeeded: 2,
        supportDiversProvidedBy: "diver",
        needsBoardingAssistance: true,
        needsWaterLift: true,
        briefingInWriting: true,
        briefingAloud: true,
        briefingBySignals: true,
        equipmentAdaptation: "  webbed gloves  ",
        divesWithName: "  Marisol Vega  ",
      }),
    ).toEqual([
      { kind: "support_divers", count: 2, providedBy: "diver" },
      { kind: "boarding_assistance" },
      { kind: "water_lift" },
      { kind: "briefing_written" },
      { kind: "briefing_aloud" },
      { kind: "briefing_signals" },
      { kind: "equipment", note: "webbed gloves" },
      // `match: null` -- no roster was supplied, so nobody checked. A surface
      // with no departure in hand states the constraint and stops.
      { kind: "dives_with", name: "Marisol Vega", match: null },
    ]);
  });

  it("counts only the support divers the shop has to find", () => {
    // The distinction the whole field exists for: summing a diver's own buddy
    // into this would have a manager roster crew for somebody already coming,
    // and the same mistake the other way leaves a diver alone in the water.
    expect(
      supportDiversToArrange([
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 2, supportDiversProvidedBy: "shop" } },
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 2, supportDiversProvidedBy: "diver" } },
        // Asked, needs nobody.
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 0 } },
        // Never asked.
        { supportNeeds: null },
        {},
        { supportNeeds: { ...NOTHING, supportDiversNeeded: 1, supportDiversProvidedBy: "shop" } },
      ]),
    ).toBe(3);
    expect(supportDiversToArrange([])).toBe(0);
  });

  it("tells a diver who was asked from one who never was", () => {
    // The only reader is the diver's own `/ready` row, which must stop asking
    // once they have answered — including when the answer was "nobody".
    expect(supportNeedsAnswered(null)).toBe(false);
    expect(supportNeedsAnswered({ ...NOTHING, statedAt: null })).toBe(false);
    expect(supportNeedsAnswered(NOTHING)).toBe(true);
    // And it stays a separate question from whether there is anything to do.
    expect(hasSupportNeeds(NOTHING)).toBe(false);
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

/**
 * Issue #1068. The name is free text a diver typed about somebody the shop may
 * hold no record of, so the match is charitable by design: a confident "not
 * booked on this departure" about somebody who *is* booked under a different
 * spelling reads as a checked fact and invites the shop to stop looking. A
 * false "yes" costs a glance down the roster; a false "no" costs the
 * arrangement.
 */
describe("matching the person a diver must dive with against the roster", () => {
  const ROSTER = ["Omar Haddad", "Marisol Vega", "Jean-Luc Béart"];

  it("says nothing when the diver named nobody", () => {
    // Not the same answer as "they are not here" -- a surface that conflated
    // the two would put a line on every diver on the boat.
    expect(divesWithMatch(null, ROSTER)).toBeNull();
    expect(divesWithMatch("", ROSTER)).toBeNull();
    expect(divesWithMatch("   ", ROSTER)).toBeNull();
  });

  it("matches the ordinary spelling, however it was typed", () => {
    expect(divesWithMatch("Omar Haddad", ROSTER)).toBe("on_departure");
    expect(divesWithMatch("  omar   haddad ", ROSTER)).toBe("on_departure");
    expect(divesWithMatch("OMAR HADDAD", ROSTER)).toBe("on_departure");
  });

  it("counts a first name alone, and a surname alone", () => {
    expect(divesWithMatch("Omar", ROSTER)).toBe("on_departure");
    expect(divesWithMatch("Haddad", ROSTER)).toBe("on_departure");
    expect(divesWithMatch("Marisol", ROSTER)).toBe("on_departure");
  });

  it("reads an initial as the word it begins", () => {
    expect(divesWithMatch("O. Haddad", ROSTER)).toBe("on_departure");
  });

  it("ignores accents and punctuation, which nobody types consistently", () => {
    expect(divesWithMatch("jean luc beart", ROSTER)).toBe("on_departure");
    expect(divesWithMatch("Béart", ROSTER)).toBe("on_departure");
  });

  it("still says no to somebody who is genuinely not aboard", () => {
    expect(divesWithMatch("Priya Sharma", ROSTER)).toBe("not_on_departure");
    // A stray initial must not match anybody it likes: "H." alone is a
    // surname's first letter, but "Zed" is nobody on this boat.
    expect(divesWithMatch("Zed", ROSTER)).toBe("not_on_departure");
    expect(divesWithMatch("Omar Sharma", ROSTER)).toBe("not_on_departure");
  });

  it("says no rather than throwing on an empty roster", () => {
    expect(divesWithMatch("Omar Haddad", [])).toBe("not_on_departure");
  });
});
