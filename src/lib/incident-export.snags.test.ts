import { describe, expect, it } from "vitest";
import {
  buildIncidentExport,
  type IncidentExportInput,
  incidentExportContentHash,
} from "./incident-export";
import { buildTripManifest } from "./manifests";

/** A departure with nobody aboard: enough document to hash. */
function input(overrides: Partial<IncidentExportInput> = {}): IncidentExportInput {
  return {
    shop: { name: "Blue Mantis", slug: "blue-mantis", timezone: "America/New_York" },
    manifests: [
      buildTripManifest({
        trip: {
          id: "trip-1",
          title: "Two-Tank Reef",
          startsAt: new Date("2026-08-04T13:00:00.000Z"),
          endsAt: new Date("2026-08-04T18:00:00.000Z"),
          plannedDives: 1,
        },
        checkpoint: "departure",
        crew: [],
        divers: [],
      }),
    ],
    diverEvidence: [],
    events: [],
    generatedAt: new Date("2026-08-04T20:00:00.000Z"),
    generatedByName: "Rae Owner",
    ...overrides,
  };
}

/**
 * The hash of `input()` as built at a8a4f877d, before `sailedWithSnags`
 * existed: a log printed then must still match a fresh export with no snags.
 */
const PRE_FIELD_HASH = "0d46a441e95fca1128142c615f66803dd9795a94335109a8704e03d65ed84af9";

/** What the crew knew when the boat left (dive-domain review of fifth-loop item 1). */
describe("buildIncidentExport: snags open when the boat sailed", () => {
  it("carries an empty list for a boat with none, and hashes as before the field existed", () => {
    const doc = buildIncidentExport(input());
    expect(doc.sailedWithSnags).toEqual([]);
    const { contentHash, ...body } = doc;
    expect(incidentExportContentHash(body)).toBe(contentHash);
    expect(contentHash).toBe(PRE_FIELD_HASH);
  });

  it("carries each one and hashes it", () => {
    const none = buildIncidentExport(input());
    const sailed = buildIncidentExport(
      input({
        sailedWithSnags: [
          {
            itemLabel: "Radio check",
            note: "VHF crackles on 16",
            notedByName: "Sal Moretti",
            notedAt: new Date("2026-08-04T09:15:00.000Z"),
          },
        ],
      }),
    );
    expect(sailed.sailedWithSnags).toEqual([
      {
        itemLabel: "Radio check",
        note: "VHF crackles on 16",
        notedByName: "Sal Moretti",
        notedAt: "2026-08-04T09:15:00.000Z",
      },
    ]);
    expect(sailed.contentHash).not.toBe(none.contentHash);
  });
});
