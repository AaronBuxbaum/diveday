import { describe, expect, it } from "vitest";
import type { WaiverRecord } from "@/db/schema";
import {
  buildIncidentExport,
  INCIDENT_EXPORT_HASH_VERSION,
  type IncidentExportHashVersion,
  incidentExportContentHash,
} from "./incident-export";
import { baseInput, completedWaiver } from "./incident-export-test-fixtures";

/**
 * **A retired refusal governing a seat prints as the refusal** (issue #3774).
 * `retireMedicalRefusal` supersedes the refused record so the seat can take a
 * fresh link; until the diver signs one, the refusal still governs
 * (`effectiveWaiverForBooking`), and readiness, the roster and the diver
 * record all say "Not cleared". The log said "no current signed waiver" and
 * dropped the physician, the evaluation and the letter.
 */
const RETIRED_AT = new Date("2026-08-03T18:00:00.000Z");

const refusal = (over: Partial<WaiverRecord> = {}) =>
  completedWaiver({
    status: "medical_review",
    medicalReviewRequired: true,
    medicalClearanceDeclinedAt: new Date("2026-08-03T09:00:00.000Z"),
    medicalClearanceDeclinedByPersonId: "staff-1",
    medicalClearanceEvaluatedOn: "2026-08-02",
    medicalClearancePhysicianName: "Dr. Imani Reyes",
    medicalClearanceDocumentUrl: "https://media.example.com/medical-clearances/no.pdf",
    supersededAt: RETIRED_AT,
    ...over,
  });

const exportWith = (waiver: WaiverRecord) =>
  buildIncidentExport(
    baseInput({
      diverEvidence: [
        {
          bookingId: "b1",
          certifications: [],
          specialtyCertifications: [],
          nitroxCertifications: [],
          waiver,
          waiverMedicalClearanceDeclinedByName: "Dana Reyes",
        },
      ],
    }),
  );

const NOT_SENT = {
  state: "not_sent",
  signedAt: null,
  templateTitle: null,
  templateVersion: null,
  signatureMethod: null,
  recordedByName: null,
  medicalClearedAt: null,
  medicalClearedByName: null,
  medicalClearanceDeclinedAt: null,
  medicalClearanceDeclinedByName: null,
  medicalClearanceEvaluatedOn: null,
  medicalClearancePhysicianName: null,
  medicalClearanceDocumentOnFile: false,
};

describe("a superseded hold on the departure log (issue #3774)", () => {
  it("prints a retired refusal as not cleared, with the physician's evidence", () => {
    const doc = exportWith(refusal());
    expect(doc.hashVersion).toBe(4);
    expect(doc.roster[0]?.waiver).toMatchObject({
      state: "medical_not_cleared",
      medicalClearedAt: null,
      medicalClearedByName: null,
      medicalClearanceDeclinedAt: "2026-08-03T09:00:00.000Z",
      medicalClearanceDeclinedByName: "Dana Reyes",
      medicalClearanceEvaluatedOn: "2026-08-02",
      medicalClearancePhysicianName: "Dr. Imani Reyes",
      medicalClearanceDocumentOnFile: true,
    });
  });

  it("prints a superseded referral nobody answered as under medical review", () => {
    const doc = exportWith(
      refusal({
        medicalClearanceDeclinedAt: null,
        medicalClearanceDeclinedByPersonId: null,
        medicalClearanceEvaluatedOn: null,
        medicalClearancePhysicianName: null,
        medicalClearanceDocumentUrl: null,
      }),
    );
    expect(doc.roster[0]?.waiver).toMatchObject({
      state: "medical_review",
      medicalClearanceDeclinedAt: null,
      medicalClearanceDeclinedByName: null,
    });
  });

  it.each([
    ["a clean signature", completedWaiver({ supersededAt: RETIRED_AT })],
    [
      "a referral a physician cleared",
      refusal({
        medicalClearanceDeclinedAt: null,
        medicalClearanceDeclinedByPersonId: null,
        medicalClearedAt: new Date("2026-08-03T09:00:00.000Z"),
        medicalClearedByPersonId: "staff-1",
      }),
    ],
  ])("still prints superseded %s as the stated absence", (_label, waiver) => {
    expect(exportWith(waiver).roster[0]?.waiver).toEqual(NOT_SENT);
  });

  /**
   * Every log sealed under versions 1 to 3 printed `not_sent` for this seat.
   * Asked for those recipes, the fresh export must hash what was printed, or
   * every earlier printout of a retired refusal stops verifying.
   */
  it.each([1, 2, 3] as const)(
    "keeps version %i's code for the seat it printed as not sent",
    (version) => {
      const fresh = exportWith(refusal());
      // The same seat as an earlier version printed it: a stated absence.
      const asPrinted = exportWith(completedWaiver({ supersededAt: RETIRED_AT }));
      expect(asPrinted.roster[0]?.waiver).toEqual(NOT_SENT);
      const { contentHash: _fresh, ...freshBody } = fresh;
      const { contentHash: _printed, ...printedBody } = asPrinted;
      expect(incidentExportContentHash(freshBody, version)).toBe(
        incidentExportContentHash(printedBody, version),
      );
    },
  );

  it("seals the refusal under version 4, so it never passes for the absence", () => {
    const fresh = exportWith(refusal());
    const asPrinted = exportWith(completedWaiver({ supersededAt: RETIRED_AT }));
    const { contentHash, ...freshBody } = fresh;
    const { contentHash: printedHash, ...printedBody } = asPrinted;
    expect(INCIDENT_EXPORT_HASH_VERSION).toBe(4);
    expect(incidentExportContentHash(freshBody)).toBe(contentHash);
    expect(contentHash).not.toBe(printedHash);
    expect(contentHash).not.toBe(incidentExportContentHash(freshBody, 3));
    expect(incidentExportContentHash(printedBody, 4)).toBe(printedHash);
  });

  it("leaves a live refusal's code under every version untouched", () => {
    const live = exportWith(refusal({ supersededAt: null }));
    expect(live.roster[0]?.waiver?.state).toBe("medical_not_cleared");
    expect(live.roster[0]).not.toHaveProperty("waiverSupersededHold");
    const { contentHash: _hash, ...body } = live;
    const retired = exportWith(refusal());
    const { contentHash: _retiredHash, ...retiredBody } = retired;
    // Version 4 prints both the same way and so seals them the same.
    expect(incidentExportContentHash(retiredBody, 4)).toBe(incidentExportContentHash(body, 4));
    for (const version of [1, 2, 3] as IncidentExportHashVersion[]) {
      expect(incidentExportContentHash(retiredBody, version)).not.toBe(
        incidentExportContentHash(body, version),
      );
    }
  });
});

/**
 * The flag is unsealed, so a body that carries it on a row it does not
 * describe must not change what versions 1 to 3 hash (security-reviewer,
 * issue #3774): only a seat printing a hold is rewritten to the absence.
 */
describe("an injected superseded-hold flag", () => {
  it.each([1, 2, 3, 4] as const)("never rewrites a signed seat under version %i", (version) => {
    const signed = exportWith(completedWaiver());
    expect(signed.roster[0]?.waiver?.state).toBe("complete");
    const { contentHash: _hash, ...body } = signed;
    const forged = {
      ...body,
      roster: body.roster.map((row) => ({ ...row, waiverSupersededHold: true as const })),
    };
    expect(incidentExportContentHash(forged, version)).toBe(
      incidentExportContentHash(body, version),
    );
  });
});
