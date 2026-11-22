/**
 * Properties of `decideTripAdmission` (src/lib/trip-admission.ts) against
 * `calculateReadiness` (src/lib/readiness.ts): the booking-time gate is weaker
 * than the boarding-time one. Example tests: trip-admission.test.ts.
 */
import fc from "fast-check";
import { describe, expect } from "vitest";
import type { TripRequirement } from "@/db/schema";
import {
  arbCertification,
  arbLevel,
  arbMoment,
  arbNitroxCertification,
  arbRequirement,
  arbSpecialtyCertification,
  arbTrainingCourse,
  PROPERTY_NOW,
  property,
} from "@/test/property";
import { PARTICIPANT_TYPES } from "./participant-types";
import { calculateReadiness, type ReadinessBlocker } from "./readiness";
import { decideTripAdmission } from "./trip-admission";

/** The demanded item a blocker is about: the level, one specialty, or nitrox. */
function demandOf(blocker: ReadinessBlocker): string {
  if (blocker.code.startsWith("certification_")) return "level";
  if (blocker.code.startsWith("specialty_")) return `specialty:${blocker.params?.specialty}`;
  if (blocker.code.startsWith("nitrox_")) return "nitrox";
  return blocker.code;
}

/**
 * One diver and one departure, as both gates see them: the cards on file, the
 * claim typed on the form, courses that finish first, a training mark the
 * course could carry, and everything readiness reads beyond cards (waiver,
 * payment, identity), so no case is "blocked" only because the generator
 * forgot a field.
 */
const arbFacts = fc.record({
  trip: fc.option(
    fc.record({ demand: arbRequirement, isDefault: fc.boolean(), requiresWaiver: fc.boolean() }),
    { nil: null },
  ),
  site: fc.option(arbRequirement, { nil: null }),
  certifications: fc.array(arbCertification, { maxLength: 4 }),
  specialtyCertifications: fc.array(arbSpecialtyCertification, { maxLength: 4 }),
  nitroxCertifications: fc.array(arbNitroxCertification, { maxLength: 2 }),
  declared: fc.option(
    fc.record({ level: fc.option(arbLevel, { nil: null }), nitrox: fc.boolean() }),
    { nil: undefined },
  ),
  inTraining: fc.array(fc.record({ level: arbLevel, finishesAt: arbMoment }), { maxLength: 2 }),
  trainingDives: fc.array(arbTrainingCourse, { maxLength: 2 }),
  markedCourse: fc.nat(3),
  reach: fc.constantFrom<"site" | "default">("site", "default"),
  participantType: fc.constantFrom(...PARTICIPANT_TYPES),
  identityUnconfirmed: fc.boolean(),
  noCertificationDeclared: fc.boolean(),
});

describe("decideTripAdmission against calculateReadiness", () => {
  /**
   * Admission never refuses someone readiness would clear: whenever the sale is
   * refused, readiness on the same diver and departure holds them on every
   * item the refusal names (and so is blocked). Readiness reads only the
   * training mark staff could have set from the courses admission considered.
   */
  property(
    "every item a refusal names, readiness also blocks on",
    [arbFacts],
    (facts) => {
      const requirement = facts.trip
        ? { ...facts.trip.demand, minimumCertificationIsDefault: facts.trip.isDefault }
        : null;
      const admission = decideTripAdmission({
        requirement,
        siteRequirement: facts.site,
        evidence: {
          certifications: facts.certifications,
          specialtyCertifications: facts.specialtyCertifications,
          nitroxCertifications: facts.nitroxCertifications,
          levelsInTraining: facts.inTraining.map((course) => course.level),
          trainingDives: facts.trainingDives,
          trainingDiveReach: facts.reach,
        },
        declared: facts.declared,
        participantType: facts.participantType,
        identityUnconfirmed: facts.identityUnconfirmed,
      });
      if (admission.admitted) return;
      expect(admission.refusal.length).toBeGreaterThan(0);

      const readiness = calculateReadiness({
        timezone: "UTC",
        now: PROPERTY_NOW,
        requirement: requirement
          ? ({
              ...requirement,
              requiresWaiver: facts.trip?.requiresWaiver ?? false,
              requiresPayment: false,
            } as TripRequirement)
          : null,
        siteRequirement: facts.site,
        waiver: null,
        certifications: facts.certifications,
        specialtyCertifications: facts.specialtyCertifications,
        nitroxCertifications: facts.nitroxCertifications,
        certificationsInTraining: facts.inTraining,
        noCertificationDeclared: facts.noCertificationDeclared,
        participantType: facts.participantType,
        identityUnconfirmed: facts.identityUnconfirmed,
        trainingDive: facts.trainingDives[facts.markedCourse] ?? null,
        trainingDiveReach: facts.reach,
      });
      expect(readiness.status).toBe("blocked");
      // A departure nobody configured is blocked whole; the item check below
      // applies once readiness reads the cards at all.
      if (requirement === null) return;
      const held = new Set(readiness.blockers.map(demandOf));
      for (const refused of admission.refusal) {
        expect(held, `refused on ${refused.code}`).toContain(demandOf(refused));
      }
    },
    { runs: 1000 },
  );
});
