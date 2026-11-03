import { describe, expect, it } from "vitest";
import type { TripRequirement, WaiverRecord } from "@/db/schema";
import { calculateReadiness, type ReadinessBlockerCode } from "./readiness";
import {
  effectiveWaiverForBooking,
  isCleanCompletion,
  isUnresolvedMedicalHold,
  releaseLapsedForBooking,
  shopWaiverStanding,
  WAIVER_SIGNATURE_VALIDITY_MS,
  waiverStanding,
} from "./waivers";

/**
 * **A waiver's standing is derived once** (issue #2705), attacked from the
 * outside: every record shape the stored columns can take, and every pair of
 * them as a diver's signed evidence, is read through the one derivation and
 * then checked against the gates that decide who boards. A word that ever
 * disagrees with a gate is the failure this file exists to catch.
 */

const NOW = new Date("2026-07-18T12:00:00.000Z");
const HOUR = 60 * 60 * 1000;

const STATUSES = ["pending", "completed", "medical_review"] as const;

/** Every combination of the columns a standing is read from. */
function everyRecord(): WaiverRecord[] {
  const records: WaiverRecord[] = [];
  let n = 0;
  for (const status of STATUSES)
    for (const cleared of [false, true])
      for (const declined of [false, true])
        for (const superseded of [false, true])
          for (const agedOut of [false, true])
            for (const generation of [1, 2])
              for (const linkRunOut of [false, true])
                for (const hoursAgo of [2, 6]) {
                  n += 1;
                  const signedAt = new Date(
                    NOW.getTime() -
                      (agedOut ? WAIVER_SIGNATURE_VALIDITY_MS + HOUR : hoursAgo * HOUR),
                  );
                  const signed = status !== "pending";
                  records.push({
                    id: `record-${n}`,
                    bookingId: `booking-${n}`,
                    personId: "person-1",
                    status,
                    templateVersion: generation,
                    templateGeneration: generation,
                    signatureMethod: null,
                    signedAt: signed ? signedAt : null,
                    completedAt: signed ? signedAt : null,
                    createdAt: new Date(signedAt.getTime() - HOUR),
                    expiresAt: new Date(NOW.getTime() + (linkRunOut ? -HOUR : HOUR)),
                    supersededAt: superseded ? new Date(NOW.getTime() - HOUR / 2) : null,
                    medicalClearedAt: cleared ? new Date(NOW.getTime() - HOUR) : null,
                    medicalClearanceEvaluatedOn: cleared ? "2026-07-17" : null,
                    medicalClearanceDeclinedAt: declined ? new Date(NOW.getTime() - HOUR) : null,
                    medicalClearanceDocumentUrl: null,
                    medicalClearanceDocumentFromDiver: false,
                  } as unknown as WaiverRecord);
                }
  return records;
}

const RECORDS = everyRecord();
/** What `listSignedWaiversByPerson` can hand over: given signatures only. */
const SIGNED = RECORDS.filter((record) => record.status !== "pending");

const requirement = {
  requiresWaiver: true,
  minimumCertificationLevel: null,
  requiredSpecialties: [],
} as unknown as TripRequirement;

const WAIVER_BLOCKERS: ReadonlySet<ReadinessBlockerCode> = new Set([
  "waiver_not_sent",
  "waiver_lapsed",
  "waiver_runs_out",
  "waiver_pending",
  "waiver_expired",
  "medical_review",
  "medical_not_cleared",
  "guardian_signature_missing",
]);

function waiverBlockers(
  waiver: WaiverRecord | null,
  participantType: "diver" | "rider",
): ReadinessBlockerCode[] {
  return calculateReadiness({
    requirement,
    waiver,
    certifications: [],
    participantType,
    timezone: "UTC",
    now: NOW,
  })
    .blockers.map((blocker) => blocker.code)
    .filter((code) => WAIVER_BLOCKERS.has(code));
}

describe("one record's standing", () => {
  it("reads every record shape as exactly the word its columns imply", () => {
    for (const record of RECORDS) {
      const standing = waiverStanding(record, NOW);
      if (isCleanCompletion(record)) {
        expect(standing, record.id).toBe("signed");
      } else if (record.status === "medical_review") {
        expect(standing, record.id).toBe(
          record.medicalClearanceDeclinedAt ? "medical_not_cleared" : "medical_review",
        );
      } else {
        expect(standing, record.id).toBe(
          record.expiresAt <= NOW ? "link_expired" : "awaiting_signature",
        );
      }
    }
    expect(waiverStanding(null, NOW)).toBe("none");
  });

  it("never calls a live medical hold anything but a hold", () => {
    for (const record of RECORDS.filter(isUnresolvedMedicalHold)) {
      expect(["medical_review", "medical_not_cleared"], record.id).toContain(
        waiverStanding(record, NOW),
      );
    }
  });

  it("never calls an unsigned link signed, however its stamps read", () => {
    for (const record of RECORDS.filter((r) => r.status === "pending")) {
      expect(waiverStanding(record, NOW), record.id).not.toBe("signed");
    }
  });

  it("raises no waiver blocker for a diver exactly when the word is signed", () => {
    for (const record of RECORDS) {
      const standing = waiverStanding(record, NOW);
      const blockers = waiverBlockers(record, "diver");
      expect(blockers.length === 0, `${record.id} ${standing} ${blockers}`).toBe(
        standing === "signed",
      );
    }
    expect(waiverBlockers(null, "diver")).toEqual(["waiver_not_sent"]);
  });

  it("holds a rider to the release and to nothing in its medical", () => {
    for (const record of RECORDS) {
      const standing = waiverStanding(record, NOW);
      const blockers = waiverBlockers(record, "rider");
      expect(blockers.length === 0, `${record.id} ${standing} ${blockers}`).toBe(
        standing === "signed" ||
          standing === "medical_review" ||
          standing === "medical_not_cleared",
      );
    }
  });
});

describe("the diver's standing at the shop agrees with every seat's", () => {
  it("names, for every pair of signed records, the word the seat's own resolution names", () => {
    let checked = 0;
    for (const first of SIGNED) {
      for (const second of SIGNED) {
        if (first === second) continue;
        for (const currentTemplateVersion of [1, 2]) {
          const personSignedWaivers = [first, second];
          const input = { personSignedWaivers, currentTemplateVersion, now: NOW };
          const shop = shopWaiverStanding(input);
          const seat = effectiveWaiverForBooking({ ...input, bookingWaiver: null });
          const label = `${first.id}+${second.id} v${currentTemplateVersion}: ${shop.state}`;
          if (seat) {
            expect(shop.state, label).toBe(waiverStanding(seat, NOW));
            if (shop.state === "signed") expect(shop.recordId, label).toBe(seat.id);
          } else {
            const lapsed = releaseLapsedForBooking({ ...input, bookingWaiver: null });
            expect(shop.state, label).toBe(lapsed ? "lapsed" : "none");
          }
          checked += 1;
        }
      }
    }
    expect(checked).toBeGreaterThan(10_000);
  });
});
