import { describe, expect, it } from "vitest";
import type { Certification, NitroxCertification, WaiverRecord } from "@/db/schema";
import {
  buildIncidentExport,
  type IncidentExportInput,
  incidentExportContentHash,
} from "./incident-export";
import { buildTripManifest, rollCallCheckpoints, type TripManifest } from "./manifests";

const TRIP = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-08-04T13:00:00.000Z"),
  endsAt: new Date("2026-08-04T18:00:00.000Z"),
  plannedDives: 2,
};

const GENERATED_AT = new Date("2026-08-04T20:00:00.000Z");

function diver(
  bookingId: string,
  fullName: string,
  rollCall?: TripManifest["divers"][number]["rollCall"],
) {
  return {
    bookingId,
    fullName,
    email: null,
    emergencyContactName: "Pat Reyes",
    emergencyContactPhone: "+1 555 0100",
    rentalFit: { state: "own_kit" as const },
    nitroxRequested: false,
    checkedIn: false,
    rollCall,
  };
}

/** All checkpoints of one trip, mirroring what getTripManifests hands the db layer. */
function manifestsFor(
  divers: Parameters<typeof buildTripManifest>[0]["divers"],
  crew: Parameters<typeof buildTripManifest>[0]["crew"] = [],
): TripManifest[] {
  return rollCallCheckpoints(TRIP.plannedDives).map((checkpoint) =>
    buildTripManifest({ trip: TRIP, checkpoint, crew, divers }),
  );
}

function completedWaiver(overrides: Partial<WaiverRecord> = {}): WaiverRecord {
  return {
    status: "completed",
    templateTitle: "Diving Release",
    templateVersion: 3,
    templateBody: "TEMPLATE-BODY-NEVER-EXPORTED",
    signedAt: new Date("2026-08-01T10:00:00.000Z"),
    completedAt: new Date("2026-08-01T10:00:00.000Z"),
    signatureMethod: null,
    supersededAt: null,
    medicalAnswers: {
      questionnaireId: "rstc",
      questionnaireVersion: 1,
      responses: { heartCondition: "MEDICAL-ANSWER-NEVER-EXPORTED" },
    },
    ...overrides,
  } as WaiverRecord;
}

function verifiedCard(overrides: Partial<Certification> = {}): Certification {
  return {
    agency: "padi",
    level: "advanced_open_water",
    identifier: "AB-1234",
    status: "verified",
    reviewedAt: new Date("2026-07-20T09:00:00.000Z"),
    expiresAt: null,
    importedAt: null,
    ...overrides,
  } as Certification;
}

function baseInput(overrides: Partial<IncidentExportInput> = {}): IncidentExportInput {
  const boarded = {
    state: "boarded" as const,
    occurredAt: new Date("2026-08-04T12:45:00.000Z"),
    recordedByName: "Captain Sol",
    note: null,
  };
  return {
    shop: { name: "Blue Mantis", slug: "blue-mantis", timezone: "America/New_York" },
    manifests: manifestsFor(
      [diver("b1", "Ana Diaz", boarded), diver("b2", "Ben Cho")],
      [{ id: "p9", fullName: "Sol Marin", roles: ["captain"], rollCall: boarded }],
    ),
    diverEvidence: [
      {
        bookingId: "b1",
        certifications: [verifiedCard()],
        specialtyCertifications: [],
        nitroxCertifications: [],
        waiver: completedWaiver(),
      },
    ],
    events: [
      {
        subjectKind: "diver",
        subjectName: "Ana Diaz",
        checkpoint: "departure",
        status: "boarded",
        source: "live",
        recordedByName: "Captain Sol",
        note: null,
        occurredAt: new Date("2026-08-04T12:45:00.000Z"),
        createdAt: new Date("2026-08-04T12:45:00.000Z"),
      },
    ],
    crewCounts: [],
    generatedAt: GENERATED_AT,
    generatedByName: "Rae Owner",
    ...overrides,
  };
}

describe("buildIncidentExport", () => {
  it("assembles the recorded facts: roster, crew, timeline, and generation metadata", () => {
    const doc = buildIncidentExport(baseInput());

    expect(doc.meta).toMatchObject({
      shopName: "Blue Mantis",
      tripId: "trip-1",
      tripTitle: "Two-Tank Reef",
      plannedDives: 2,
      checkpoints: ["departure", "after_dive_1", "after_dive_2"],
      generatedAt: GENERATED_AT.toISOString(),
      generatedByName: "Rae Owner",
    });
    expect(doc.departureSummary).toEqual({
      totalDivers: 2,
      boarded: 1,
      notBoarded: 0,
      awaiting: 1,
      crewAssigned: 1,
    });

    const ana = doc.roster.find((entry) => entry.bookingId === "b1");
    expect(ana?.rollCall[0]).toMatchObject({
      checkpoint: "departure",
      label: "boarded",
      occurredAt: "2026-08-04T12:45:00.000Z",
      recordedByName: "Captain Sol",
    });
    expect(ana?.certifications).toEqual([
      {
        kind: "level",
        agency: "padi",
        level: "advanced_open_water",
        specialty: null,
        identifier: "AB-1234",
        status: "verified",
        reviewedAt: "2026-07-20T09:00:00.000Z",
        expiresAt: null,
        imported: false,
      },
    ]);
    expect(ana?.waiver).toEqual({
      state: "complete",
      signedAt: "2026-08-01T10:00:00.000Z",
      templateTitle: "Diving Release",
      templateVersion: 3,
      signatureMethod: null,
    });

    expect(doc.crew).toHaveLength(1);
    expect(doc.crew[0]).toMatchObject({ fullName: "Sol Marin", roles: ["captain"] });
    expect(doc.crew[0]?.rollCall[0]).toMatchObject({ label: "boarded" });

    expect(doc.timeline).toHaveLength(1);
    expect(doc.timeline[0]).toMatchObject({
      kind: "diver",
      subjectName: "Ana Diaz",
      action: "boarded",
      source: "live",
    });
  });

  it("states absence for a departure with no roll call yet — awaiting everywhere, empty timeline", () => {
    const doc = buildIncidentExport(
      baseInput({
        manifests: manifestsFor([diver("b1", "Ana Diaz"), diver("b2", "Ben Cho")]),
        events: [],
        crewCounts: [],
      }),
    );

    expect(doc.timeline).toEqual([]);
    for (const entry of doc.roster) {
      expect(entry.rollCall).toHaveLength(3);
      for (const result of entry.rollCall) {
        expect(result).toMatchObject({
          label: "awaiting",
          occurredAt: null,
          recordedByName: null,
        });
      }
    }
  });

  it("keeps a diver with no certification evidence on the document with an explicit empty set", () => {
    // Ben has no diverEvidence entry at all — the harsher variant of "no cards".
    const doc = buildIncidentExport(baseInput());
    const ben = doc.roster.find((entry) => entry.bookingId === "b2");

    expect(ben).toBeDefined();
    expect(ben?.certifications).toEqual([]);
    expect(ben?.waiver).toMatchObject({ state: "not_sent", signedAt: null });
  });

  it("reads a superseded completion as the stated absence, never as signed evidence", () => {
    const doc = buildIncidentExport(
      baseInput({
        diverEvidence: [
          {
            bookingId: "b1",
            certifications: [],
            specialtyCertifications: [],
            nitroxCertifications: [],
            waiver: completedWaiver({ supersededAt: new Date("2026-08-02T00:00:00.000Z") }),
          },
        ],
      }),
    );

    expect(doc.roster.find((entry) => entry.bookingId === "b1")?.waiver).toEqual({
      state: "not_sent",
      signedAt: null,
      templateTitle: null,
      templateVersion: null,
      signatureMethod: null,
    });
  });

  it("reports a medical hold as a status only — answers and template body never appear", () => {
    const doc = buildIncidentExport(
      baseInput({
        diverEvidence: [
          {
            bookingId: "b1",
            certifications: [],
            specialtyCertifications: [],
            nitroxCertifications: [],
            waiver: completedWaiver({ status: "medical_review", signedAt: null }),
          },
        ],
      }),
    );

    expect(doc.roster[0]?.waiver.state).toBe("medical_review");
    const serialized = JSON.stringify(doc);
    expect(serialized).not.toContain("MEDICAL-ANSWER-NEVER-EXPORTED");
    expect(serialized).not.toContain("TEMPLATE-BODY-NEVER-EXPORTED");
    expect(serialized).not.toContain("medicalAnswers");
  });

  it("carries an after-dive not-back-aboard result and a cleared correction verbatim", () => {
    const notBack = {
      state: "not_boarded" as const,
      occurredAt: new Date("2026-08-04T15:00:00.000Z"),
      recordedByName: "Captain Sol",
      note: "Not at the ladder count",
    };
    const manifests = rollCallCheckpoints(TRIP.plannedDives).map((checkpoint) =>
      buildTripManifest({
        trip: TRIP,
        checkpoint,
        crew: [],
        divers: [diver("b1", "Ana Diaz", checkpoint === "after_dive_1" ? notBack : undefined)],
      }),
    );
    const doc = buildIncidentExport(
      baseInput({
        manifests,
        events: [
          {
            subjectKind: "diver",
            subjectName: "Ana Diaz",
            checkpoint: "after_dive_1",
            status: "not_boarded",
            source: "offline",
            recordedByName: "Captain Sol",
            note: "Not at the ladder count",
            occurredAt: new Date("2026-08-04T15:00:00.000Z"),
            createdAt: new Date("2026-08-04T15:00:01.000Z"),
          },
          {
            subjectKind: "diver",
            subjectName: "Ana Diaz",
            checkpoint: "departure",
            status: "cleared",
            source: "live",
            recordedByName: "Rae Owner",
            note: null,
            occurredAt: new Date("2026-08-04T12:50:00.000Z"),
            createdAt: new Date("2026-08-04T12:50:00.000Z"),
          },
        ],
      }),
    );

    // The after-dive absence keeps the manifest's own loud label, and the
    // correction stays in the record — an incident document never launders
    // history.
    const ana = doc.roster[0];
    expect(ana?.rollCall[1]).toMatchObject({
      checkpoint: "after_dive_1",
      label: "not_back_aboard",
    });
    expect(doc.timeline.map((entry) => ("action" in entry ? entry.action : entry.kind))).toEqual([
      "cleared",
      "not_boarded",
    ]);
    expect(doc.timeline[1]).toMatchObject({ source: "offline", note: "Not at the ladder count" });
  });

  it("interleaves crew counts into the timeline in time order", () => {
    const doc = buildIncidentExport(
      baseInput({
        crewCounts: [
          {
            checkpoint: "departure",
            crewAboard: 2,
            crewAssigned: 2,
            attestedByName: "Rae Owner",
            note: null,
            occurredAt: new Date("2026-08-04T12:40:00.000Z"),
            createdAt: new Date("2026-08-04T12:40:00.000Z"),
          },
        ],
      }),
    );

    expect(doc.timeline.map((entry) => entry.kind)).toEqual(["crew_count", "diver"]);
    expect(doc.timeline[0]).toMatchObject({ crewAboard: 2, crewAssigned: 2 });
  });

  it("marks imported cards and nitrox evidence distinctly", () => {
    const doc = buildIncidentExport(
      baseInput({
        diverEvidence: [
          {
            bookingId: "b1",
            certifications: [verifiedCard({ importedAt: new Date("2026-07-01T00:00:00.000Z") })],
            specialtyCertifications: [],
            nitroxCertifications: [
              {
                agency: "padi",
                identifier: "NX-9",
                status: "pending",
                reviewedAt: null,
                importedAt: null,
              } as NitroxCertification,
            ],
            waiver: null,
          },
        ],
      }),
    );

    const cards = doc.roster.find((entry) => entry.bookingId === "b1")?.certifications;
    expect(cards).toHaveLength(2);
    expect(cards?.[0]).toMatchObject({ kind: "level", imported: true });
    expect(cards?.[1]).toMatchObject({ kind: "nitrox", status: "pending", imported: false });
  });

  it("hashes the facts deterministically, so an unchanged record reproduces the hash", () => {
    const a = buildIncidentExport(baseInput());
    const b = buildIncidentExport(baseInput());
    expect(a.contentHash).toBe(b.contentHash);
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);

    const { contentHash, ...body } = a;
    expect(incidentExportContentHash(body)).toBe(contentHash);

    const edited = buildIncidentExport(
      baseInput({
        events: [
          {
            subjectKind: "diver",
            subjectName: "Ana Diaz",
            checkpoint: "departure",
            status: "boarded",
            source: "live",
            recordedByName: "Captain Sol",
            note: "edited after the fact",
            occurredAt: new Date("2026-08-04T12:45:00.000Z"),
            createdAt: new Date("2026-08-04T12:45:00.000Z"),
          },
        ],
      }),
    );
    expect(edited.contentHash).not.toBe(a.contentHash);
  });

  it("hashes the printed facts, not internal row ids", () => {
    // Same facts under different ids — the printout is pixel-identical, so the
    // integrity code must match too (and must survive a data re-import that
    // reassigns every row id).
    const a = buildIncidentExport(baseInput());
    const differentIds = baseInput();
    const doc = buildIncidentExport({
      ...differentIds,
      manifests: differentIds.manifests.map((manifest) => ({
        ...manifest,
        trip: { ...manifest.trip, id: "trip-OTHER" },
        divers: manifest.divers.map((entry) => ({
          ...entry,
          bookingId: `other-${entry.bookingId}`,
        })),
      })),
      diverEvidence: differentIds.diverEvidence.map((entry) => ({
        ...entry,
        bookingId: `other-${entry.bookingId}`,
      })),
    });
    expect(doc.contentHash).toBe(a.contentHash);
  });

  it("refuses to build a document with no departure manifest", () => {
    expect(() => buildIncidentExport(baseInput({ manifests: [] }))).toThrow(
      /no departure manifest/,
    );
  });

  describe("buddy pairs", () => {
    const PAIRED_AT = new Date("2026-08-04T08:12:00.000Z");

    /** Ana and Ben paired; Cleo sails unpaired, which is a normal boat. */
    function pairedInput(overrides: Partial<IncidentExportInput> = {}) {
      const ana = { ...diver("b1", "Ana Diaz"), buddy: { bookingId: "b2", fullName: "Ben Cho" } };
      const ben = { ...diver("b2", "Ben Cho"), buddy: { bookingId: "b1", fullName: "Ana Diaz" } };
      return baseInput({
        manifests: manifestsFor([ana, ben, diver("b3", "Cleo Vance")]),
        events: [],
        crewCounts: [],
        buddyPairings: [
          { bookingId: "b1", teamNumber: 1, pairedByName: "Sol Marin", pairedAt: PAIRED_AT },
          { bookingId: "b2", teamNumber: 1, pairedByName: "Sol Marin", pairedAt: PAIRED_AT },
        ],
        ...overrides,
      });
    }

    it("records who each diver was paired with — the first question an investigator asks", () => {
      const doc = buildIncidentExport(pairedInput());
      const byName = (name: string) => doc.roster.find((entry) => entry.fullName === name);

      expect(byName("Ana Diaz")?.buddy?.buddyName).toBe("Ben Cho");
      expect(byName("Ben Cho")?.buddy?.buddyName).toBe("Ana Diaz");
    });

    it("states when the pairing was made and who made it — a pairing is never anonymous", () => {
      // The document's contract is facts *with* their timestamp and recorder.
      // A pairing decided at the dock and one typed in that night are different
      // facts, and only the provenance can tell them apart.
      const ana = buildIncidentExport(pairedInput()).roster.find(
        (entry) => entry.fullName === "Ana Diaz",
      );
      expect(ana?.buddy?.pairedByName).toBe("Sol Marin");
      expect(ana?.buddy?.pairedAt).toBe(PAIRED_AT.toISOString());
    });

    it("numbers the team so both members can be found on a printed roster", () => {
      const doc = buildIncidentExport(pairedInput());
      const team = (name: string) =>
        doc.roster.find((entry) => entry.fullName === name)?.buddy?.teamNumber;
      // Both halves carry the same number — that is the whole point: a reader
      // scanning for "Team 01" finds both rows without chasing names.
      expect(team("Ana Diaz")).toBe(1);
      expect(team("Ben Cho")).toBe(1);
    });

    it("still prints the pairing when its provenance is missing, rather than dropping it", () => {
      // The pairing is the safety fact; its recorder is the detail. Losing the
      // detail must never lose the fact.
      const doc = buildIncidentExport(pairedInput({ buddyPairings: [] }));
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");
      expect(ana?.buddy?.buddyName).toBe("Ben Cho");
      expect(ana?.buddy?.pairedByName).toBeNull();
      expect(ana?.buddy?.pairedAt).toBeNull();
    });

    it("states an unpaired diver as an explicit absence, never a blank or a crash", () => {
      const doc = buildIncidentExport(pairedInput());
      // `null` is the stated absence the page turns into words; an unpaired
      // remainder is a normal boat, not a gap in the record.
      expect(doc.roster.find((entry) => entry.fullName === "Cleo Vance")?.buddy).toBeNull();
      // And a departure where nobody was paired still builds every row.
      const none = buildIncidentExport(baseInput());
      expect(none.roster.every((entry) => entry.buddy === null)).toBe(true);
      expect(none.roster).toHaveLength(2);
    });

    it("carries the buddy by name only — no booking id reaches the document", () => {
      const doc = buildIncidentExport(pairedInput());
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");
      expect(ana).not.toHaveProperty("buddyBookingId");
      expect(ana?.buddy?.buddyName).toBe("Ben Cho");
      expect(ana?.buddy).not.toHaveProperty("bookingId");

      // And the id stays out of the *hashed* facts: re-importing a shop
      // reassigns every row id without changing a printed word, so a pairing
      // that leaked an id would break the integrity code of an otherwise
      // identical document.
      const reimported = pairedInput();
      const rehashed = buildIncidentExport({
        ...reimported,
        manifests: reimported.manifests.map((manifest) => ({
          ...manifest,
          divers: manifest.divers.map((entry) => ({
            ...entry,
            bookingId: `other-${entry.bookingId}`,
            buddy: entry.buddy
              ? { ...entry.buddy, bookingId: `other-${entry.buddy.bookingId}` }
              : entry.buddy,
          })),
        })),
        diverEvidence: reimported.diverEvidence.map((entry) => ({
          ...entry,
          bookingId: `other-${entry.bookingId}`,
        })),
        // A re-import reassigns the pairing rows' booking ids too — remapping
        // the manifest but not these would be testing a state that cannot
        // happen, and would "pass" only by losing the provenance.
        buddyPairings: reimported.buddyPairings?.map((entry) => ({
          ...entry,
          bookingId: `other-${entry.bookingId}`,
        })),
      });
      expect(rehashed.contentHash).toBe(doc.contentHash);
    });

    it("commits the pairing to the integrity code — repairing divers changes the hash", () => {
      const paired = buildIncidentExport(pairedInput());
      const unpaired = buildIncidentExport(
        baseInput({
          manifests: manifestsFor([
            diver("b1", "Ana Diaz"),
            diver("b2", "Ben Cho"),
            diver("b3", "Cleo Vance"),
          ]),
          events: [],
          crewCounts: [],
        }),
      );
      // Who dived with whom is a printed fact, so a printout claiming a
      // different pairing must not verify against a fresh export.
      expect(paired.contentHash).not.toBe(unpaired.contentHash);
      // Same records twice still reproduces, so the code stays checkable.
      expect(buildIncidentExport(pairedInput()).contentHash).toBe(paired.contentHash);
    });

    it("never restates the live manifest's split-pair alert — this document computes no verdict", () => {
      // Ana is back aboard after dive 1 and Ben is not: the state a live
      // manifest raises loudly. Here it must show only as the two recorded
      // roll-call results, with no derived alert field on the row.
      const notBack = undefined;
      const boarded = {
        state: "boarded" as const,
        occurredAt: new Date("2026-08-04T14:30:00.000Z"),
        recordedByName: "Captain Sol",
        note: null,
        implied: false,
        source: "live" as const,
      };
      const manifests = rollCallCheckpoints(TRIP.plannedDives).map((checkpoint) =>
        buildTripManifest({
          trip: TRIP,
          checkpoint,
          crew: [],
          divers: [
            {
              ...diver("b1", "Ana Diaz", checkpoint === "after_dive_1" ? boarded : undefined),
              buddy: { bookingId: "b2", fullName: "Ben Cho" },
            },
            {
              ...diver("b2", "Ben Cho", notBack),
              buddy: { bookingId: "b1", fullName: "Ana Diaz" },
            },
          ],
        }),
      );
      const doc = buildIncidentExport(baseInput({ manifests, events: [], crewCounts: [] }));
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");

      expect(ana?.buddy?.buddyName).toBe("Ben Cho");
      expect(ana).not.toHaveProperty("buddyAlert");
      expect(ana?.buddy).not.toHaveProperty("alert");
      // The facts a reader needs are the two roll-call rows, stated plainly.
      const afterDive1 = ana?.rollCall.find((r) => r.checkpoint === "after_dive_1");
      expect(afterDive1?.label).toBe("boarded");
      const ben = doc.roster.find((entry) => entry.fullName === "Ben Cho");
      expect(ben?.rollCall.find((r) => r.checkpoint === "after_dive_1")?.label).toBe("awaiting");
    });
  });
});
