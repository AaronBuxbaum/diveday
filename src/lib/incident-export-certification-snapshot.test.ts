import { describe, expect, it } from "vitest";
import { buildIncidentExport, incidentExportContentHash } from "./incident-export";
import { baseInput, verifiedCard } from "./incident-export-test-fixtures";

describe("departure-log certification evidence", () => {
  it("distinguishes an empty capture from unavailable evidence and refuses to seal it with an older recipe", () => {
    const input = baseInput();
    const missing = buildIncidentExport(input);
    const captured = buildIncidentExport({
      ...input,
      diverEvidence: [
        {
          bookingId: "b1",
          certifications: [],
          specialtyCertifications: [],
          nitroxCertifications: [],
          certificationsStartedAt: "2026-08-04T13:00:00.000Z",
          certificationsCapturedAt: "2026-08-04T13:00:00.000Z",
          certificationsAtCapture: [],
          waiver: null,
        },
      ],
    });
    expect(missing.roster[0]?.certificationsAtCapture).toBeNull();
    expect(captured.roster[0]?.certificationsAtCapture).toEqual([]);
    expect(captured.contentHash).not.toBe(missing.contentHash);
    expect(() => incidentExportContentHash(captured, 1)).toThrow(/boarding certification evidence/);
    expect(() => incidentExportContentHash(captured, 2)).toThrow(/boarding certification evidence/);
    expect(() => incidentExportContentHash(missing, 2)).not.toThrow();
  });
  it("prints current cards without letting them change the historical integrity code", () => {
    const input = baseInput();
    const evidence = {
      bookingId: "b1",
      certifications: [],
      specialtyCertifications: [],
      nitroxCertifications: [],
      certificationsStartedAt: "2026-08-04T13:00:00.000Z",
      certificationsCapturedAt: "2026-08-04T13:00:00.000Z",
      certificationsAtCapture: [],
      waiver: null,
    };
    const before = buildIncidentExport({ ...input, diverEvidence: [evidence] });
    const after = buildIncidentExport({
      ...input,
      diverEvidence: [{ ...evidence, certifications: [verifiedCard()] }],
    });
    expect(after.roster[0]?.certifications).toHaveLength(1);
    expect(after.contentHash).toBe(before.contentHash);
  });
});
