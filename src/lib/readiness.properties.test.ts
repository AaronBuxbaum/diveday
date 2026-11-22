/**
 * Properties of `calculateReadiness` (src/lib/readiness.ts): the boarding gate
 * fails closed. Rules: `.claude/rules/domain.md` "Certifications" and
 * "Waivers". Example tests: readiness.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import type {
  Certification,
  NitroxCertification,
  SpecialtyCertification,
  TripRequirement,
  WaiverRecord,
} from "@/db/schema";
import {
  arbCertification,
  arbDay,
  arbLevel,
  arbMoment,
  arbNitroxCertification,
  arbRequirement,
  arbSpecialty,
  arbSpecialtyCertification,
  arbTrainingCourse,
  PROPERTY_NOW,
  property,
} from "@/test/property";
import {
  calendarDateInTimezone,
  isValidCalendarDate,
  shiftCalendarDate,
  shiftCalendarDateMonths,
} from "./calendar-date";
import { PARTICIPANT_TYPES } from "./participant-types";
import {
  BLOCKER_CATEGORY,
  calculateReadiness,
  certificationRank,
  type ReadinessInput,
} from "./readiness";

const arbStamp = fc.option(arbMoment, { nil: null });

/** A release in any state readiness distinguishes, or none on file. */
const arbWaiver = fc.option(
  fc
    .record({
      status: fc.constantFrom("pending", "completed", "medical_review"),
      signedAt: arbStamp,
      completedAt: arbStamp,
      guardianSignedAt: arbStamp,
      medicalClearedAt: arbStamp,
      medicalClearanceDeclinedAt: arbStamp,
      integrityValid: fc.constantFrom(true, false, null),
    })
    .map((waiver) => waiver as unknown as WaiverRecord),
  { nil: null },
);

const arbTripRequirement = fc
  .record({
    demand: arbRequirement,
    requiresWaiver: fc.boolean(),
    requiresPayment: fc.boolean(),
    minimumCertificationIsDefault: fc.boolean(),
  })
  .map(({ demand, ...rest }) => ({ ...demand, ...rest }) as unknown as TripRequirement);

/** Every input a boarding decision reads, each in any state. */
const arbInput: fc.Arbitrary<ReadinessInput> = fc.record({
  timezone: fc.constantFrom("UTC", "America/New_York", "Pacific/Kiritimati"),
  now: fc.constant(PROPERTY_NOW),
  requirement: fc.option(arbTripRequirement, { nil: null }),
  siteRequirement: fc.option(arbRequirement, { nil: null }),
  waiver: arbWaiver,
  releaseLapse: fc.constantFrom(null, "lapsed", "before_trip"),
  certifications: fc.array(arbCertification, { maxLength: 4 }),
  specialtyCertifications: fc.array(arbSpecialtyCertification, { maxLength: 4 }),
  nitroxCertifications: fc.array(arbNitroxCertification, { maxLength: 2 }),
  certificationsInTraining: fc.array(fc.record({ level: arbLevel, finishesAt: arbMoment }), {
    maxLength: 2,
  }),
  noCertificationDeclared: fc.boolean(),
  paymentStatus: fc.constantFrom(
    null,
    "unpaid",
    "deposit_paid",
    "paid",
    "waived",
    "partly_refunded",
    "refunded",
  ),
  identityUnconfirmed: fc.boolean(),
  dateOfBirth: fc.option(arbDay, { nil: null }),
  minorDeclared: fc.boolean(),
  participantType: fc.constantFrom(...PARTICIPANT_TYPES),
  statedFree: fc.boolean(),
  waiverSealFailed: fc.boolean(),
  trainingDive: fc.option(arbTrainingCourse, { nil: null }),
  trainingDiveReach: fc.constantFrom<"site" | "default">("site", "default"),
  coursesEnded: fc.array(
    fc.record({ level: arbLevel, finishesAt: arbMoment, tripId: fc.constant("trip-ended") }),
    { maxLength: 2 },
  ),
  courseDate: fc.option(arbDay, { nil: null }),
  courseMinimumAge: fc.option(fc.integer({ min: 8, max: 18 }), { nil: null }),
}) as fc.Arbitrary<ReadinessInput>;

/** A departure that asks only for cards, with nothing else on the diver standing in the way. */
const arbCardsOnlyInput: fc.Arbitrary<ReadinessInput> = fc
  .tuple(
    arbInput,
    arbTripRequirement,
    fc.option(arbSpecialty, { nil: undefined }),
    fc.constantFrom(...PARTICIPANT_TYPES, "diver", "diver"),
  )
  .map(([input, requirement, specialty, participantType]) => ({
    ...input,
    requirement: {
      ...requirement,
      requiredSpecialties: specialty ? [specialty] : [],
      requiresWaiver: false,
      requiresPayment: false,
    },
    siteRequirement: null,
    participantType,
    waiver: null,
    identityUnconfirmed: false,
    waiverSealFailed: false,
    courseDate: null,
  }));

type Card =
  | { kind: "level"; card: Certification }
  | { kind: "specialty"; card: SpecialtyCertification }
  | { kind: "nitrox"; card: NitroxCertification };

const arbCard: fc.Arbitrary<Card> = fc.oneof(
  { arbitrary: arbCertification.map((card) => ({ kind: "level" as const, card })), weight: 2 },
  {
    arbitrary: arbSpecialtyCertification.map((card) => ({ kind: "specialty" as const, card })),
    weight: 1,
  },
  {
    arbitrary: arbNitroxCertification.map((card) => ({ kind: "nitrox" as const, card })),
    weight: 1,
  },
);

function withCard(input: ReadinessInput, added: Card): ReadinessInput {
  if (added.kind === "level") {
    return { ...input, certifications: [...input.certifications, added.card] };
  }
  if (added.kind === "specialty") {
    return {
      ...input,
      specialtyCertifications: [...(input.specialtyCertifications ?? []), added.card],
    };
  }
  return { ...input, nitroxCertifications: [...(input.nitroxCertifications ?? []), added.card] };
}

/** A departure that asks only for a level: nothing else can block. */
function levelOnly(level: Certification["level"]): TripRequirement {
  return {
    minimumCertificationLevel: level,
    minimumCertificationIsDefault: false,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresWaiver: false,
    requiresPayment: false,
  } as unknown as TripRequirement;
}

describe("calculateReadiness fails closed", () => {
  /** Missing requirement configuration blocks, whatever else is true of the diver. */
  property("a departure with no requirement row blocks", [arbInput], (input) => {
    const result = calculateReadiness({ ...input, requirement: null });
    expect(result.status).toBe("blocked");
    expect(result.blockers.map((b) => b.code)).toContain("requirements_not_configured");
  });

  /** Every blocker readiness raises is one of the typed codes, never a free string. */
  property("every blocker is a typed code", [arbInput], (input) => {
    const result = calculateReadiness(input);
    for (const blocker of result.blockers) {
      expect(Object.hasOwn(BLOCKER_CATEGORY, blocker.code), blocker.code).toBe(true);
    }
    expect(result.status === "ready").toBe(result.blockers.length === 0);
  });

  /**
   * On a departure that asks only for a level, a diver clears exactly when
   * some card is verified and at or above that level: a pending card, a
   * claim, a course in training or a lower card never clears.
   */
  property(
    "only a verified card at or above the level clears it",
    [arbLevel, fc.array(arbCertification, { maxLength: 5 }), fc.array(arbLevel, { maxLength: 2 })],
    (level, certifications, training) => {
      const result = calculateReadiness({
        timezone: "UTC",
        now: PROPERTY_NOW,
        requirement: levelOnly(level),
        waiver: null,
        certifications,
        certificationsInTraining: training.map((rung) => ({
          level: rung,
          finishesAt: new Date(PROPERTY_NOW.getTime() + 86_400_000),
        })),
      });
      const clears = certifications.some(
        (card) =>
          card.status === "verified" && certificationRank(card.level) >= certificationRank(level),
      );
      expect(result.status).toBe(clears ? "ready" : "blocked");
    },
  );

  /**
   * Monotone in evidence: a diver who is ready without one more card on file
   * is still ready with it, so adding a card never blocks and removing one
   * never clears. Drawn mostly from departures that ask only for cards, so a
   * fair share of the generated divers start out ready.
   */
  property(
    "adding a card never turns a ready diver blocked",
    [
      fc.oneof({ arbitrary: arbCardsOnlyInput, weight: 3 }, { arbitrary: arbInput, weight: 1 }),
      arbCard,
    ],
    (input, card) => {
      const without = calculateReadiness(input);
      if (without.status !== "ready") return;
      expect(calculateReadiness(withCard(input, card)).status).toBe("ready");
    },
    { runs: 3000 },
  );

  /**
   * A medical referral nobody cleared holds every diver and snorkeler on
   * every departure, configured or not, whatever the departure's waiver box.
   */
  property(
    "an uncleared medical referral blocks",
    [arbInput, fc.constantFrom("diver" as const, "snorkeler" as const), fc.boolean()],
    (input, participantType, declined) => {
      const waiver = {
        status: "medical_review",
        signedAt: PROPERTY_NOW,
        completedAt: null,
        guardianSignedAt: null,
        medicalClearedAt: null,
        medicalClearanceDeclinedAt: declined ? PROPERTY_NOW : null,
        integrityValid: true,
      } as unknown as WaiverRecord;
      const result = calculateReadiness({ ...input, participantType, waiver });
      expect(result.status).toBe("blocked");
      expect(result.blockers.map((b) => b.code)).toContain(
        declined ? "medical_not_cleared" : "medical_review",
      );
    },
  );

  /**
   * A release signed by someone under 18 on the day they signed (by the date
   * of birth on file, or with none, by the booker's "Under 18"), with no
   * guardian signature, blocks on a departure that asks for a release.
   */
  property(
    "a minor's release without a guardian signature blocks",
    [arbInput, arbTripRequirement, fc.integer({ min: 0, max: 17 }), fc.nat(364), fc.boolean()],
    (input, requirement, years, days, declaredOnly) => {
      const signedOn = "2026-07-21";
      // A date of birth on file decides; with none, the booker's "Under 18" does.
      const dateOfBirth = declaredOnly
        ? null
        : shiftCalendarDate(shiftCalendarDateMonths(signedOn, -12 * years), -days);
      const waiver = {
        status: "completed",
        signedAt: new Date(`${signedOn}T12:00:00Z`),
        completedAt: null,
        guardianSignedAt: null,
        medicalClearedAt: null,
        medicalClearanceDeclinedAt: null,
        integrityValid: true,
      } as unknown as WaiverRecord;
      const result = calculateReadiness({
        ...input,
        timezone: "UTC",
        requirement: { ...requirement, requiresWaiver: true },
        waiver,
        dateOfBirth,
        minorDeclared: declaredOnly ? true : input.minorDeclared,
      });
      expect(result.blockers.map((b) => b.code)).toContain("guardian_signature_missing");
    },
  );

  /**
   * The guardian rule changes exactly on the 18th birthday, measured on the
   * shop's own calendar day: a solo release signed at any hour, in any zone,
   * blocks when the local signing day is before the birthday and never from
   * it on. A 29 February birth comes of age on 1 March in a common year
   * (the later day, so the rule errs toward asking a guardian).
   */
  property(
    "the guardian rule changes exactly on the 18th birthday in the shop's zone",
    [
      fc.oneof(
        arbDay.map((day) => shiftCalendarDateMonths(day, -12 * 18)),
        fc.constantFrom("2008-02-29", "2004-02-29", "2008-03-01", "2008-12-31", "2009-01-01"),
      ),
      fc.constantFrom(
        "UTC",
        "Pacific/Honolulu",
        "Pacific/Kiritimati",
        "America/New_York",
        "Asia/Tokyo",
      ),
      fc.integer({ min: -72 * 60, max: 72 * 60 }),
    ],
    (dateOfBirth, timezone, minutes) => {
      const monthDay = dateOfBirth.slice(5);
      const year = Number(dateOfBirth.slice(0, 4)) + 18;
      const anniversary = `${year}-${monthDay}`;
      const adultFrom = isValidCalendarDate(anniversary) ? anniversary : `${year}-03-01`;
      const signedAt = new Date(new Date(`${adultFrom}T12:00:00Z`).getTime() + minutes * 60_000);
      const result = calculateReadiness({
        timezone,
        now: PROPERTY_NOW,
        requirement: { ...levelOnly("open_water"), requiresWaiver: true } as TripRequirement,
        waiver: {
          status: "completed",
          signedAt,
          guardianSignedAt: null,
        } as unknown as WaiverRecord,
        certifications: [{ level: "open_water", status: "verified" } as Certification],
        dateOfBirth,
      });
      const signedOn = calendarDateInTimezone(signedAt, timezone);
      expect(result.blockers.some((b) => b.code === "guardian_signature_missing")).toBe(
        signedOn < adultFrom,
      );
    },
  );
});

/** A departure that asks for one thing and nothing else, for a diver with nothing else in the way. */
function onlyDemand(demand: Partial<TripRequirement>): TripRequirement {
  return {
    minimumCertificationLevel: null,
    minimumCertificationIsDefault: false,
    requiredSpecialties: [],
    requiresNitrox: false,
    requiresWaiver: false,
    requiresPayment: false,
    ...demand,
  } as unknown as TripRequirement;
}

describe("calculateReadiness specialty and nitrox gates", () => {
  /**
   * A specialty gate clears exactly when a card of that specialty is verified
   * and, if it was imported, a staffer has confirmed it (ADR
   * 20260725-import-specialty-cards): a pending card, an unreviewed import or
   * another specialty's card never clears it.
   */
  property(
    "only a verified, confirmed card of the specialty clears it",
    [arbSpecialty, fc.array(arbSpecialtyCertification, { maxLength: 4 })],
    (specialty, cards) => {
      const result = calculateReadiness({
        timezone: "UTC",
        now: PROPERTY_NOW,
        requirement: onlyDemand({ requiredSpecialties: [specialty] }),
        waiver: null,
        certifications: [],
        specialtyCertifications: cards,
      });
      const clears = cards.some(
        (card) =>
          card.specialty === specialty &&
          card.status === "verified" &&
          (!card.importedAt || Boolean(card.reviewedAt)),
      );
      expect(result.status).toBe(clears ? "ready" : "blocked");
    },
    { runs: 1000 },
  );

  /** A nitrox gate clears exactly when a nitrox card is verified; a pending card or a bare tick never clears it. */
  property(
    "only a verified nitrox card clears the nitrox gate",
    [fc.array(arbNitroxCertification, { maxLength: 3 })],
    (cards) => {
      const result = calculateReadiness({
        timezone: "UTC",
        now: PROPERTY_NOW,
        requirement: onlyDemand({ requiresNitrox: true }),
        waiver: null,
        certifications: [],
        nitroxCertifications: cards,
      });
      const clears = cards.some((card) => card.status === "verified");
      expect(result.status).toBe(clears ? "ready" : "blocked");
    },
  );
});

describe("calculateReadiness training dives and courses", () => {
  /**
   * A level the trip itself sets (not the default nobody chose) is never
   * lowered by a training mark, whatever the course, the site and the reach:
   * a diver with no verified card at that level stays blocked on the level.
   */
  property(
    "a training mark never lowers a level the trip set",
    [arbInput, arbLevel, arbTrainingCourse],
    (input, level, course) => {
      const result = calculateReadiness({
        ...input,
        participantType: "diver",
        requirement: onlyDemand({ minimumCertificationLevel: level }),
        trainingDive: course,
      });
      const holdsLevel = input.certifications.some(
        (card) =>
          card.status === "verified" && certificationRank(card.level) >= certificationRank(level),
      );
      if (holdsLevel) return;
      expect(result.blockers.some((b) => b.code.startsWith("certification_"))).toBe(true);
    },
  );

  /**
   * A course in training or a course that already ended is never evidence:
   * adding either to a diver held on the level leaves them held on the level.
   */
  property(
    "courses in training or ended never clear a level",
    [
      arbInput,
      arbLevel,
      fc.array(fc.record({ level: arbLevel, finishesAt: arbMoment }), {
        minLength: 1,
        maxLength: 3,
      }),
    ],
    (input, level, courses) => {
      const base = {
        ...input,
        participantType: "diver" as const,
        trainingDive: null,
        requirement: onlyDemand({ minimumCertificationLevel: level }),
        certificationsInTraining: [],
        coursesEnded: [],
      };
      const levelHeld = (result: ReturnType<typeof calculateReadiness>) =>
        result.blockers.some((b) => b.code.startsWith("certification_"));
      if (!levelHeld(calculateReadiness(base))) return;
      const withCourses = calculateReadiness({
        ...base,
        certificationsInTraining: courses,
        coursesEnded: courses.map((course) => ({ ...course, tripId: "trip-ended" })),
      });
      expect(levelHeld(withCourses)).toBe(true);
    },
  );

  /**
   * A diver younger than the course's minimum age on the day the course runs
   * is blocked, on any departure, configured or not.
   */
  property(
    "a diver under the course minimum age is blocked",
    [arbInput, fc.integer({ min: 8, max: 18 }), fc.integer({ min: 1, max: 8 }), fc.nat(364)],
    (input, minimumAge, yearsShort, days) => {
      const courseDate = "2026-07-21";
      const age = Math.max(0, minimumAge - yearsShort);
      const dateOfBirth = shiftCalendarDate(shiftCalendarDateMonths(courseDate, -12 * age), -days);
      const result = calculateReadiness({
        ...input,
        participantType: "diver",
        courseDate,
        courseMinimumAge: minimumAge,
        dateOfBirth,
      });
      expect(result.blockers.map((b) => b.code)).toContain("under_minimum_age");
    },
  );
});
