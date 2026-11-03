import { describe, expect, expectTypeOf, it } from "vitest";
import type { Certification, TripRequirement, WaiverRecord } from "@/db/schema";
import { courseCrewGap } from "./course-ratios";
import { checkDepthCeiling, type DepthCeilingCheck, diverDepthLimit } from "./depth-ceiling";
import { DIVE_RECENCY_BANDS } from "./dive-recency";
import { divemasterRatioGap } from "./divemaster-ratio";
import {
  ADVISORY_CODES,
  type Advisory,
  type AdvisoryCode,
  courseCrewFinding,
  depthAdvisoryIn,
  depthFinding,
  divemasterFinding,
  FINDING_STRICTNESS,
  type FindingCode,
  findingsStatus,
  minimumSeatsFinding,
  preDepartureFinding,
  recencyFinding,
} from "./findings";
import { minimumSeatsState } from "./minimum-seats";
import {
  BLOCKER_CATEGORY,
  calculateReadiness,
  type ReadinessBlockerCode,
  type ReadinessInput,
  type ReadinessResult,
} from "./readiness";

const BLOCKER_CODES = Object.keys(BLOCKER_CATEGORY) as ReadinessBlockerCode[];

/** One of every advisory a module can produce, built through its own adapter. */
function everyAdvisory(): Advisory[] {
  const startsAt = new Date("2026-08-14T12:00:00.000Z");
  const findings = [
    depthFinding({
      status: "exceeds",
      siteDepth: 30,
      limitDepth: 18,
      unit: "meters",
      basis: "certification",
      level: "open_water",
    }),
    depthFinding({ status: "verification_required", verificationReasons: ["junior_limits"] }),
    recencyFinding("never"),
    courseCrewFinding({ code: "no_instructor" }),
    courseCrewFinding({
      code: "over_ratio",
      booked: 9,
      capacity: 8,
      ratio: "entry_level",
      remedy: "assistant",
    }),
    divemasterFinding(
      divemasterRatioGap({ divers: 12, divemasterCount: 1, diversPerDivemaster: 6 }),
    ),
    minimumSeatsFinding(
      minimumSeatsState(
        { minimumBookings: 4, minimumDecisionHours: 48, startsAt, capacity: 10 },
        1,
        new Date("2026-08-01T12:00:00.000Z"),
      ),
    ),
    minimumSeatsFinding(
      minimumSeatsState(
        { minimumBookings: 4, minimumDecisionHours: 48, startsAt, capacity: 10 },
        1,
        new Date("2026-08-14T11:00:00.000Z"),
      ),
    ),
    preDepartureFinding({ checked: 3, total: 5 }),
  ];
  return findings.filter((finding): finding is NonNullable<typeof finding> => finding !== null);
}

describe("the strictness table", () => {
  it("tables every blocker code `blocks` and every advisory code `informs`, and nothing else", () => {
    for (const code of BLOCKER_CODES) expect(FINDING_STRICTNESS[code]).toBe("blocks");
    for (const code of ADVISORY_CODES) expect(FINDING_STRICTNESS[code]).toBe("informs");
    expect(Object.keys(FINDING_STRICTNESS).sort()).toEqual(
      [...BLOCKER_CODES, ...ADVISORY_CODES].sort(),
    );
  });

  it("has no code that is both a blocker and an advisory", () => {
    const blockers = new Set<string>(BLOCKER_CODES);
    expect(ADVISORY_CODES.filter((code) => blockers.has(code))).toEqual([]);
    // And the compiler agrees: the overlap of the two unions is empty.
    expectTypeOf<Extract<ReadinessBlockerCode, AdvisoryCode>>().toBeNever();
  });

  it("keeps advisories out of the blocker list by type", () => {
    // `.blockers` is read in dozens of places; none of them can meet an advisory.
    expectTypeOf<Extract<ReadinessResult["blockers"][number]["code"], AdvisoryCode>>().toBeNever();
    // `calculateReadiness` has no advisory input to be handed one through.
    expectTypeOf<
      Extract<keyof ReadinessInput, "advisories" | "depthAdvisory" | "lastDivedBand">
    >().toBeNever();
  });
});

describe("findingsStatus: advisories never gate boarding", () => {
  it("is ready with nothing to say", () => {
    expect(findingsStatus([])).toBe("ready");
  });

  it("is ready under every advisory every module can produce, all at once", () => {
    const all = everyAdvisory();
    // The fixture really does exercise every advisory code.
    expect(new Set(all.map((finding) => finding.code))).toEqual(new Set(ADVISORY_CODES));
    expect(findingsStatus(all)).toBe("ready");
    for (const finding of all) expect(findingsStatus([finding])).toBe("ready");
  });

  it("is blocked by any one blocker, wherever it sits among advisories", () => {
    for (const code of BLOCKER_CODES) {
      const all: { code: FindingCode }[] = everyAdvisory();
      expect(findingsStatus([{ code }, ...all])).toBe("blocked");
      expect(findingsStatus([...all, { code }])).toBe("blocked");
    }
  });

  it("fails closed on a code the table does not know", () => {
    // A stale cached row, a typo, a value that came round the types, or a key
    // every object inherits: none of them is an advisory.
    for (const code of [
      "",
      "depth",
      "DEPTH_EXCEEDS_CEILING",
      "depth_exceeds_ceiling ",
      "informs",
      "toString",
      "constructor",
      "__proto__",
      "hasOwnProperty",
    ]) {
      expect(findingsStatus([{ code }])).toBe("blocked");
      expect(findingsStatus([...everyAdvisory(), { code }])).toBe("blocked");
    }
  });
});

describe("calculateReadiness", () => {
  const now = new Date("2026-07-18T12:00:00.000Z");
  const ready: ReadinessInput = {
    timezone: "UTC",
    requirement: {
      requiresWaiver: true,
      minimumCertificationLevel: "advanced_open_water",
      requiredSpecialties: [],
    } as unknown as TripRequirement,
    waiver: {
      status: "completed",
      expiresAt: new Date("2026-07-25T12:00:00.000Z"),
    } as WaiverRecord,
    certifications: [{ status: "verified", level: "advanced_open_water" } as Certification],
    participantType: "diver",
    now,
  };

  it("derives its status from the table", () => {
    const result = calculateReadiness(ready);
    expect(result).toEqual({ status: "ready", blockers: [] });
    expect(result.status).toBe(findingsStatus(result.blockers));
    const blocked = calculateReadiness({ ...ready, waiver: null });
    expect(blocked.status).toBe("blocked");
    expect(blocked.status).toBe(findingsStatus(blocked.blockers));
  });

  it("stays ready when every advisory is smuggled into its input", () => {
    // The evaluator takes no advisory input. Handing it every shape one could
    // arrive in, past the types, must change nothing.
    const smuggled = {
      ...ready,
      advisories: everyAdvisory(),
      depthAdvisory: { status: "exceeds", siteDepth: 40, limitDepth: 12 },
      lastDivedBand: "never",
      blockers: everyAdvisory(),
    } as unknown as ReadinessInput;
    expect(calculateReadiness(smuggled)).toEqual({ status: "ready", blockers: [] });
  });

  it("never returns an advisory code among its blockers, across many inputs", () => {
    const advisoryCodes = new Set<string>(ADVISORY_CODES);
    const inputs: ReadinessInput[] = [
      ready,
      { ...ready, waiver: null },
      { ...ready, certifications: [] },
      { ...ready, requirement: null },
      { ...ready, identityUnconfirmed: true },
      { ...ready, participantType: "rider" },
      { ...ready, participantType: "snorkeler" },
      {
        ...ready,
        courseDate: "2026-07-20",
        courseMinimumAge: 15,
        dateOfBirth: "2014-01-01",
      } as ReadinessInput,
    ];
    for (const input of inputs) {
      const { blockers } = calculateReadiness(input);
      expect(blockers.filter((blocker) => advisoryCodes.has(blocker.code))).toEqual([]);
    }
  });
});

describe("the adapters", () => {
  it("say nothing about a depth within the ceiling, or an unknown one", () => {
    const silent: DepthCeilingCheck[] = [
      { status: "unknown" },
      { status: "within", siteDepth: 12, limitDepth: 18, unit: "meters" },
    ];
    for (const check of silent) expect(depthFinding(check)).toBeNull();
    expect(depthFinding(null)).toBeNull();
    expect(depthFinding(undefined)).toBeNull();
  });

  it("carry the depth check's own numbers, in the shop's unit", () => {
    const limit = diverDepthLimit(
      [{ status: "verified", level: "open_water" } as Certification],
      [],
    );
    expect(depthFinding(checkDepthCeiling(30, limit, "meters"))).toEqual({
      code: "depth_exceeds_ceiling",
      params: {
        siteDepth: 30,
        limitDepth: 18,
        unit: "meters",
        basis: "certification",
        level: "open_water",
      },
    });
    // The textbook Florida 60 ft reef under a 60 ft card says nothing.
    expect(depthFinding(checkDepthCeiling(18.288, limit, "feet"))).toBeNull();
  });

  it("pick out only the two recency answers a divemaster reads twice", () => {
    const notable = DIVE_RECENCY_BANDS.filter((band) => recencyFinding(band) !== null);
    expect(notable).toEqual(["over_five_years", "never"]);
    expect(recencyFinding(null)).toBeNull();
    expect(recencyFinding(undefined)).toBeNull();
  });

  it("say nothing when a course, a boat or a departure has no gap", () => {
    expect(
      courseCrewFinding(
        courseCrewGap({ course: null, instructorCount: 0, assistantCount: 0, booked: 4 }),
      ),
    ).toBeNull();
    expect(
      divemasterFinding(
        divemasterRatioGap({ divers: 6, divemasterCount: 1, diversPerDivemaster: 6 }),
      ),
    ).toBeNull();
    expect(
      divemasterFinding(
        divemasterRatioGap({
          divers: 30,
          divemasterCount: 0,
          diversPerDivemaster: 6,
          selfGuided: true,
        }),
      ),
    ).toBeNull();
    const startsAt = new Date("2026-08-14T12:00:00.000Z");
    expect(
      minimumSeatsFinding(
        minimumSeatsState(
          { minimumBookings: 4, minimumDecisionHours: 48, startsAt, capacity: 10 },
          4,
        ),
      ),
    ).toBeNull();
    expect(
      minimumSeatsFinding(
        minimumSeatsState(
          { minimumBookings: null, minimumDecisionHours: null, startsAt, capacity: 10 },
          0,
        ),
      ),
    ).toBeNull();
    expect(preDepartureFinding({ checked: 5, total: 5 })).toBeNull();
    expect(preDepartureFinding({ checked: 0, total: 0 })).toBeNull();
    expect(preDepartureFinding({ checked: 7, total: 5 })).toBeNull();
  });

  it("find the depth advisory among a seat's advisories", () => {
    const depth = depthFinding({
      status: "verification_required",
      verificationReasons: ["card_status"],
    });
    const recency = recencyFinding("over_five_years");
    if (!depth || !recency) throw new Error("fixture");
    expect(depthAdvisoryIn([recency, depth])).toBe(depth);
    expect(depthAdvisoryIn([recency])).toBeUndefined();
    expect(depthAdvisoryIn(undefined)).toBeUndefined();
  });
});
