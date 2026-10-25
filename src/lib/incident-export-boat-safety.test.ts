import { describe, expect, it } from "vitest";
import {
  buildIncidentExport,
  type IncidentExportInput,
  incidentExportContentHash,
} from "./incident-export";
import { buildTripManifest, rollCallCheckpoints } from "./manifests";

/**
 * **The boat at the departure checkpoint** (issue 2300): the departure log
 * carries the snapshot verbatim, states its absence as null, and a log
 * printed before snapshots existed keeps its integrity code.
 */

const TRIP = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-08-04T13:00:00.000Z"),
  endsAt: new Date("2026-08-04T18:00:00.000Z"),
  plannedDives: 2,
};

function baseInput(): IncidentExportInput {
  const divers = [
    {
      bookingId: "b1",
      fullName: "Ana Diaz",
      email: null,
      emergencyContactName: "Pat Reyes",
      emergencyContactPhone: "+1 555 0100",
      rentalFit: { state: "own_kit" as const },
      nitroxRequested: false,
      checkedIn: false,
    },
  ];
  return {
    shop: { name: "Blue Mantis", slug: "blue-mantis", timezone: "America/New_York" },
    manifests: rollCallCheckpoints(TRIP.plannedDives).map((checkpoint) =>
      buildTripManifest({ trip: TRIP, checkpoint, crew: [], divers }),
    ),
    diverEvidence: [],
    events: [],
    generatedAt: new Date("2026-08-04T20:00:00.000Z"),
    generatedByName: "Rae Owner",
  };
}

describe("the boat at the departure checkpoint on the departure log", () => {
  const snapshot = {
    boatId: "boat-1",
    boatName: "Reef Runner",
    judgedOn: "2026-08-04",
    capturedAt: new Date("2026-08-04T12:40:00.000Z"),
    papers: {
      certifiedPassengers: 12,
      certifiedTotalPersons: 15,
      coiExpiresOn: "2027-05-01",
      inspectionDueOn: "2026-08-01",
      registrationExpiresOn: null,
      insuranceExpiresOn: null,
    },
    notices: [
      { code: "paper", paper: "inspection", dueOn: "2026-08-01", expired: true, days: 3 },
    ] as const,
  };

  it("states no snapshot as null, and hashes exactly as before snapshots existed", () => {
    const doc = buildIncidentExport(baseInput());
    expect(doc.boatSafety).toBeNull();
    const { contentHash, boatSafety: _boatSafety, ...rest } = doc;
    // A log printed before #2300 carried no boatSafety at all; its code holds.
    expect(
      incidentExportContentHash({ ...rest, boatSafety: null } as Parameters<
        typeof incidentExportContentHash
      >[0]),
    ).toBe(contentHash);
  });

  it("carries the papers and notices verbatim, and the hash covers them", () => {
    const without = buildIncidentExport(baseInput());
    const doc = buildIncidentExport({
      ...baseInput(),
      boatSafety: snapshot,
      departureBoatId: "boat-1",
    });
    expect(doc.boatSafety).toEqual({
      boatName: "Reef Runner",
      boatChanged: false,
      judgedOn: "2026-08-04",
      capturedAt: "2026-08-04T12:40:00.000Z",
      papers: snapshot.papers,
      notices: [...snapshot.notices],
    });
    expect(doc.contentHash).not.toBe(without.contentHash);

    const renewed = buildIncidentExport({
      ...baseInput(),
      boatSafety: { ...snapshot, papers: { ...snapshot.papers, inspectionDueOn: "2027-08-01" } },
    });
    expect(renewed.contentHash).not.toBe(doc.contentHash);
    expect(
      buildIncidentExport({ ...baseInput(), boatSafety: snapshot, departureBoatId: "boat-1" })
        .contentHash,
    ).toBe(doc.contentHash);
  });

  it("carries the checklist answer kept with the snapshot, hashed; a record without one keeps its code (#2725)", () => {
    const before = buildIncidentExport({
      ...baseInput(),
      boatSafety: { ...snapshot, checklist: null },
      departureBoatId: "boat-1",
    });
    expect(before.boatSafety).not.toHaveProperty("checklist");
    expect(before.contentHash).toBe(
      buildIncidentExport({ ...baseInput(), boatSafety: snapshot, departureBoatId: "boat-1" })
        .contentHash,
    );
    const answer = { itemCount: 3, unchecked: ["Flares in date"] };
    const kept = buildIncidentExport({
      ...baseInput(),
      boatSafety: { ...snapshot, checklist: answer },
      departureBoatId: "boat-1",
    });
    expect(kept.boatSafety?.checklist).toEqual(answer);
    expect(kept.contentHash).not.toBe(before.contentHash);
  });

  // Review D1: absence is worded by what is known, never "no roll call".
  it("says why nothing was kept: no boat on the departure, or simply not kept", () => {
    const noBoat = buildIncidentExport({ ...baseInput(), departureBoatId: null });
    expect(noBoat.boatSafety).toBeNull();
    expect(noBoat.boatSafetyAbsence).toBe("no_boat");
    const notKept = buildIncidentExport({ ...baseInput(), departureBoatId: "boat-1" });
    expect(notKept.boatSafetyAbsence).toBe("not_kept");
    // The reason is read off today's departure, not a fact of the day: unhashed.
    expect(notKept.contentHash).toBe(noBoat.contentHash);
    const kept = buildIncidentExport({
      ...baseInput(),
      boatSafety: snapshot,
      departureBoatId: "boat-1",
    });
    expect(kept.boatSafetyAbsence).toBeNull();
  });

  // Review D6: a boat swapped after the count is said, not hidden.
  it("says when the departure's boat is no longer the hull that was kept", () => {
    const swapped = buildIncidentExport({
      ...baseInput(),
      boatSafety: snapshot,
      departureBoatId: "boat-2",
    });
    expect(swapped.boatSafety?.boatChanged).toBe(true);
    const removed = buildIncidentExport({
      ...baseInput(),
      boatSafety: snapshot,
      departureBoatId: null,
    });
    expect(removed.boatSafety?.boatChanged).toBe(true);
  });
});
