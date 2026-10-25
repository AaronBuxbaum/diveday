import { describe, expect, it } from "vitest";
import { checkpointGap } from "./checkpoint-gaps";
import { buildIncidentExport, incidentExportContentHash } from "./incident-export";
import {
  baseInput,
  diver,
  manifestCrew,
  manifestsFor,
  TRIP,
} from "./incident-export-test-fixtures";
import { buildTripManifest, rollCallCheckpoints } from "./manifests";

/**
 * **A turned-away seat on the checkpoint warning and the departure log**
 * (issue #2907). Eleven booked, Priya turned away for her waiver before the
 * first dock count, the other ten marked aboard at every count: the warning
 * says nothing is unmarked, and the log lists ten passengers and one line
 * saying she was turned away, with the category and nothing behind it.
 */
const boarded = {
  state: "boarded" as const,
  occurredAt: new Date("2026-08-04T12:45:00.000Z"),
  recordedByName: "Captain Sol",
};
const captain = manifestCrew({
  id: "p9",
  fullName: "Sol Marin",
  roles: ["captain"],
  rollCall: boarded,
});
const ten = Array.from({ length: 10 }, (_, index) => diver(`b${index}`, `Diver ${index}`, boarded));
const priya = {
  ...diver("b-priya", "Priya Sharma"),
  notHere: true,
  turnedAway: true,
  turnedAwayReason: "medical" as const,
  readiness: { status: "blocked" as const, blockers: [{ code: "medical_review" as const }] },
};

describe("a turned-away seat at the checkpoint warning (#2907)", () => {
  it("says nothing is unmarked at any checkpoint", () => {
    const manifests = manifestsFor([...ten, priya], [captain]);
    for (const checkpoint of rollCallCheckpoints(2)) {
      expect(checkpointGap(manifests, checkpoint)).toBeNull();
    }
  });

  it("still counts a diver nobody has marked beside her", () => {
    const manifests = manifestsFor([...ten.slice(0, 9), diver("b-late", "Late"), priya], [captain]);
    expect(checkpointGap(manifests, "departure")).toMatchObject({ kind: "unmarked", divers: 1 });
  });
});

describe("a turned-away seat on the departure log (#2907)", () => {
  const doc = buildIncidentExport(
    baseInput({ manifests: manifestsFor([...ten, priya], [captain]) }),
  );

  it("lists ten passengers, none awaiting, and a turned-away line with the category", () => {
    expect(doc.departureSummary).toMatchObject({ totalDivers: 10, boarded: 10, awaiting: 0 });
    expect(doc.roster).toHaveLength(10);
    expect(doc.roster.map((entry) => entry.fullName)).not.toContain("Priya Sharma");
    expect(doc.turnedAway).toEqual([
      { bookingId: "b-priya", fullName: "Priya Sharma", reason: "medical" },
    ]);
  });

  it("carries the category and nothing else about her", () => {
    expect(Object.keys(doc.turnedAway[0] ?? {}).sort()).toEqual([
      "bookingId",
      "fullName",
      "reason",
    ]);
  });

  it("seals the line into the code, which then has no version-1 recipe", () => {
    const { contentHash, ...body } = doc;
    expect(incidentExportContentHash({ ...body, turnedAway: [] })).not.toBe(contentHash);
    expect(() => incidentExportContentHash(body, 1)).toThrow();
  });

  it("keeps a turned-away seat on the table once anybody at the boat recorded her", () => {
    // Recorded not back aboard after dive 1: a person the log must keep, cell and all.
    const divers = [...ten, priya];
    const manifests = rollCallCheckpoints(2).map((checkpoint) =>
      buildTripManifest({
        trip: TRIP,
        checkpoint,
        crew: [captain],
        divers:
          checkpoint === "after_dive_1"
            ? divers.map((row) =>
                row.bookingId === "b-priya"
                  ? { ...row, rollCall: { ...boarded, state: "not_boarded" as const } }
                  : row,
              )
            : divers,
      }),
    );
    const kept = buildIncidentExport(baseInput({ manifests }));
    expect(kept.turnedAway).toEqual([]);
    expect(kept.roster.map((entry) => entry.fullName)).toContain("Priya Sharma");
  });

  it("states a seat with no reason left (erased) as turned away, the reason unknown", () => {
    const erased = { ...priya, turnedAwayReason: null };
    const plain = buildIncidentExport(baseInput({ manifests: manifestsFor([...ten, erased]) }));
    expect(plain.turnedAway).toEqual([
      { bookingId: "b-priya", fullName: "Priya Sharma", reason: null },
    ]);
  });

  it("adds nothing to a log with nobody turned away", () => {
    expect(buildIncidentExport(baseInput()).turnedAway).toEqual([]);
  });
});
