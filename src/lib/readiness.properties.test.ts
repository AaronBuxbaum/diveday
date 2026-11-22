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
  PROPERTY_NOW,
  property,
} from "@/test/property";
import { shiftCalendarDate, shiftCalendarDateMonths } from "./calendar-date";
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
   * A release signed by someone under 18 on the day they signed, with no
   * guardian signature, blocks on a departure that asks for a release.
   */
  property(
    "a minor's release without a guardian signature blocks",
    [arbInput, arbTripRequirement, fc.integer({ min: 0, max: 17 }), fc.nat(364)],
    (input, requirement, years, days) => {
      const signedOn = "2026-07-21";
      const dateOfBirth = shiftCalendarDate(shiftCalendarDateMonths(signedOn, -12 * years), -days);
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
      });
      expect(result.blockers.map((b) => b.code)).toContain("guardian_signature_missing");
    },
  );

  /**
   * The minor boundary flips exactly once: over the days around a diver's
   * 18th birthday, a solo release signed on each day blocks before the
   * birthday and stops blocking from it on, with one transition.
   */
  property(
    "the guardian rule flips once across the 18th birthday",
    [arbDay, fc.integer({ min: 1, max: 5 })],
    (dateOfBirth, span) => {
      const birthday = shiftCalendarDateMonths(dateOfBirth, 12 * 18);
      const flags: boolean[] = [];
      for (let offset = -span; offset <= span; offset += 1) {
        const signedOn = shiftCalendarDate(birthday, offset);
        const result = calculateReadiness({
          timezone: "UTC",
          now: PROPERTY_NOW,
          requirement: { ...levelOnly("open_water"), requiresWaiver: true } as TripRequirement,
          waiver: {
            status: "completed",
            signedAt: new Date(`${signedOn}T12:00:00Z`),
            guardianSignedAt: null,
          } as unknown as WaiverRecord,
          certifications: [{ level: "open_water", status: "verified" } as Certification],
          dateOfBirth,
        });
        flags.push(result.blockers.some((b) => b.code === "guardian_signature_missing"));
      }
      const transitions = flags.filter((flag, index) => index > 0 && flag !== flags[index - 1]);
      expect(flags[0]).toBe(true);
      expect(flags.at(-1)).toBe(false);
      expect(transitions).toHaveLength(1);
    },
  );
});
