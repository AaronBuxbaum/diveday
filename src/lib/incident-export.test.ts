import { describe, expect, it } from "vitest";
import type { Certification, NitroxCertification, WaiverRecord } from "@/db/schema";
import {
  buildIncidentExport,
  type IncidentBuddyTeamInput,
  type IncidentExportInput,
  incidentExportContentHash,
} from "./incident-export";
import {
  buildTripManifest,
  type ManifestCrewMember,
  rollCallCheckpoints,
  type TripManifest,
} from "./manifests";

/** A manifest crew member with no emergency contact on file — the ordinary state. */
const manifestCrew = (
  member: Omit<ManifestCrewMember, "emergencyContactName" | "emergencyContactPhone"> &
    Partial<Pick<ManifestCrewMember, "emergencyContactName" | "emergencyContactPhone">>,
): ManifestCrewMember => ({
  emergencyContactName: null,
  emergencyContactPhone: null,
  ...member,
});

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
      [manifestCrew({ id: "p9", fullName: "Sol Marin", roles: ["captain"], rollCall: boarded })],
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

  describe("buddy teams", () => {
    const PAIRED_AT = new Date("2026-08-04T08:12:00.000Z");

    const diverMember = (bookingId: string, fullName: string) =>
      ({ kind: "diver", bookingId, fullName }) as const;
    const crewMember = (personId: string, fullName: string) =>
      ({ kind: "crew", personId, fullName }) as const;
    const teamOf = (
      teamId: string,
      members: IncidentBuddyTeamInput["members"],
    ): IncidentBuddyTeamInput => ({
      teamId,
      members,
      recordedByName: "Sol Marin",
      recordedAt: PAIRED_AT,
    });

    /** Ana and Ben on a team; Cleo sails unteamed, which is a normal boat. */
    function teamedInput(overrides: Partial<IncidentExportInput> = {}) {
      return baseInput({
        manifests: manifestsFor([
          diver("b1", "Ana Diaz"),
          diver("b2", "Ben Cho"),
          diver("b3", "Cleo Vance"),
        ]),
        events: [],
        crewCounts: [],
        buddyTeams: [teamOf("t1", [diverMember("b1", "Ana Diaz"), diverMember("b2", "Ben Cho")])],
        ...overrides,
      });
    }

    it("records who each diver was on a team with — the first question an investigator asks", () => {
      const doc = buildIncidentExport(teamedInput());
      const names = (name: string) =>
        doc.roster
          .find((entry) => entry.fullName === name)
          ?.buddy?.members.map((member) => member.fullName);

      expect(names("Ana Diaz")).toEqual(["Ben Cho"]);
      expect(names("Ben Cho")).toEqual(["Ana Diaz"]);
    });

    it("carries a team of three as a list, not a single buddy", () => {
      const doc = buildIncidentExport(
        teamedInput({
          buddyTeams: [
            teamOf("t1", [
              diverMember("b1", "Ana Diaz"),
              diverMember("b2", "Ben Cho"),
              diverMember("b3", "Cleo Vance"),
            ]),
          ],
        }),
      );
      expect(
        doc.roster
          .find((entry) => entry.fullName === "Ana Diaz")
          ?.buddy?.members.map((member) => member.fullName),
      ).toEqual(["Ben Cho", "Cleo Vance"]);
    });

    it("marks a crew member as crew — the distinction this document exists to keep", () => {
      // Before the team model, a diver deliberately placed with a divemaster
      // printed identically to a diver nobody paired: "accompanied" and
      // "unaccompanied" read the same on the one page where they must not.
      const doc = buildIncidentExport(
        teamedInput({
          buddyTeams: [
            teamOf("t1", [diverMember("b1", "Ana Diaz"), crewMember("p9", "Keiko Tanaka")]),
          ],
        }),
      );
      expect(doc.roster.find((entry) => entry.fullName === "Ana Diaz")?.buddy?.members).toEqual([
        { fullName: "Keiko Tanaka", isCrew: true },
      ]);
      // …and a diver nobody teamed still reads as an explicit absence, so the
      // two cases can never be confused again.
      expect(doc.roster.find((entry) => entry.fullName === "Ben Cho")?.buddy).toBeNull();
    });

    it("prints every team a crew member led, by number", () => {
      const doc = buildIncidentExport(
        teamedInput({
          manifests: manifestsFor(
            [diver("b1", "Ana Diaz"), diver("b2", "Ben Cho")],
            [manifestCrew({ id: "p9", fullName: "Keiko Tanaka", roles: ["divemaster"] })],
          ),
          buddyTeams: [
            teamOf("t1", [diverMember("b1", "Ana Diaz"), crewMember("p9", "Keiko Tanaka")]),
            teamOf("t2", [diverMember("b2", "Ben Cho"), crewMember("p9", "Keiko Tanaka")]),
          ],
        }),
      );
      expect(doc.crew.find((entry) => entry.fullName === "Keiko Tanaka")?.buddyTeamNumbers).toEqual(
        [1, 2],
      );
    });

    it("states when the team was recorded and who recorded it — never anonymous", () => {
      // The document's contract is facts *with* their timestamp and recorder.
      // A team decided at the dock and one typed in that night are different
      // facts, and only the provenance can tell them apart.
      const ana = buildIncidentExport(teamedInput()).roster.find(
        (entry) => entry.fullName === "Ana Diaz",
      );
      expect(ana?.buddy?.pairedByName).toBe("Sol Marin");
      expect(ana?.buddy?.pairedAt).toBe(PAIRED_AT.toISOString());
    });

    it("numbers the team so every member can be found on a printed roster", () => {
      const doc = buildIncidentExport(teamedInput());
      const team = (name: string) =>
        doc.roster.find((entry) => entry.fullName === name)?.buddy?.teamNumber;
      // Every member carries the same number — that is the whole point: a
      // reader scanning for "Team 01" finds all the rows without chasing names.
      expect(team("Ana Diaz")).toBe(1);
      expect(team("Ben Cho")).toBe(1);
    });

    it("still prints the team when its provenance is missing, rather than dropping it", () => {
      // The pairing is the safety fact; its recorder is the detail. Losing the
      // detail must never lose the fact.
      const doc = buildIncidentExport(
        teamedInput({
          buddyTeams: [
            {
              teamId: "t1",
              members: [diverMember("b1", "Ana Diaz"), diverMember("b2", "Ben Cho")],
              recordedByName: null,
              recordedAt: null,
            },
          ],
        }),
      );
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");
      expect(ana?.buddy?.members).toEqual([{ fullName: "Ben Cho", isCrew: false }]);
      expect(ana?.buddy?.pairedByName).toBeNull();
      expect(ana?.buddy?.pairedAt).toBeNull();
    });

    it("states an unteamed diver as an explicit absence, never a blank or a crash", () => {
      const doc = buildIncidentExport(teamedInput());
      // `null` is the stated absence the page turns into words; an unteamed
      // remainder is a normal boat, not a gap in the record.
      expect(doc.roster.find((entry) => entry.fullName === "Cleo Vance")?.buddy).toBeNull();
      // And a departure where nobody was teamed still builds every row.
      const none = buildIncidentExport(baseInput());
      expect(none.roster.every((entry) => entry.buddy === null)).toBe(true);
      expect(none.roster).toHaveLength(2);
    });

    it("says nothing about a team reduced to one member aboard", () => {
      // The db layer drops a cancelled seat before this point. A team of one
      // has nobody to name, and "Team 01" over an empty list would read as a
      // gap in the record rather than as the cancellation it is.
      const doc = buildIncidentExport(
        teamedInput({ buddyTeams: [teamOf("t1", [diverMember("b1", "Ana Diaz")])] }),
      );
      expect(doc.roster.find((entry) => entry.fullName === "Ana Diaz")?.buddy).toBeNull();
    });

    it("carries members by name only — no booking id reaches the document", () => {
      const doc = buildIncidentExport(teamedInput());
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");
      expect(ana?.buddy?.members).toEqual([{ fullName: "Ben Cho", isCrew: false }]);
      expect(JSON.stringify(ana?.buddy)).not.toContain("b2");

      // And the id stays out of the *hashed* facts: re-importing a shop
      // reassigns every row id without changing a printed word, so a pairing
      // that leaked an id would break the integrity code of an otherwise
      // identical document.
      const reimported = teamedInput();
      const rehashed = buildIncidentExport({
        ...reimported,
        manifests: reimported.manifests.map((manifest) => ({
          ...manifest,
          divers: manifest.divers.map((entry) => ({
            ...entry,
            bookingId: `other-${entry.bookingId}`,
          })),
        })),
        diverEvidence: reimported.diverEvidence.map((entry) => ({
          ...entry,
          bookingId: `other-${entry.bookingId}`,
        })),
        // A re-import reassigns the membership rows' booking ids too —
        // remapping the manifest but not these would be testing a state that
        // cannot happen, and would "pass" only by losing the pairing.
        buddyTeams: reimported.buddyTeams?.map((team) => ({
          ...team,
          members: team.members.map((member) =>
            member.kind === "diver"
              ? { ...member, bookingId: `other-${member.bookingId}` }
              : member,
          ),
        })),
      });
      expect(rehashed.contentHash).toBe(doc.contentHash);
    });

    it("commits the pairing to the integrity code — re-teaming divers changes the hash", () => {
      const teamed = buildIncidentExport(teamedInput());
      const unteamed = buildIncidentExport(
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
      expect(teamed.contentHash).not.toBe(unteamed.contentHash);
      // Same records twice still reproduces, so the code stays checkable.
      expect(buildIncidentExport(teamedInput()).contentHash).toBe(teamed.contentHash);
    });

    it("renders the pairing trail in the timeline — the gap this model closed", () => {
      // Buddy used to be the only fact on this document with no timeline
      // entry: a pairing could be rewritten or erased after an incident with
      // no mark at all.
      const doc = buildIncidentExport(
        teamedInput({
          buddyTeamEvents: [
            {
              teamId: "t1",
              action: "formed",
              memberNames: ["Ana Diaz", "Ben Cho"],
              recordedByName: "Sol Marin",
              occurredAt: PAIRED_AT,
              createdAt: PAIRED_AT,
            },
            {
              teamId: "t-gone",
              action: "dissolved",
              memberNames: ["Cleo Vance", "Dee Okoro"],
              recordedByName: "Sol Marin",
              occurredAt: new Date("2026-08-04T09:00:00.000Z"),
              createdAt: new Date("2026-08-04T09:00:00.000Z"),
            },
          ],
        }),
      );
      const trail = doc.timeline.filter((entry) => entry.kind === "buddy_team");
      expect(trail).toHaveLength(2);
      expect(trail[0]).toMatchObject({
        action: "formed",
        teamNumber: 1,
        memberNames: ["Ana Diaz", "Ben Cho"],
        recordedByName: "Sol Marin",
        checkpoint: null,
      });
      // A team that no longer stands has no roster number to print, and says
      // so rather than borrowing one — the names are what survived, which is
      // exactly why they are denormalised.
      expect(trail[1]).toMatchObject({
        action: "dissolved",
        teamNumber: 0,
        memberNames: ["Cleo Vance", "Dee Okoro"],
      });
    });

    it("commits the trail to the integrity code, and interleaves it with the head count by time", () => {
      const withTrail = teamedInput({
        buddyTeamEvents: [
          {
            teamId: "t1",
            action: "formed",
            memberNames: ["Ana Diaz", "Ben Cho"],
            recordedByName: "Sol Marin",
            occurredAt: PAIRED_AT,
            createdAt: PAIRED_AT,
          },
        ],
        crewCounts: [
          {
            checkpoint: "departure",
            crewAboard: 2,
            crewAssigned: 2,
            attestedByName: "Captain Sol",
            note: null,
            occurredAt: new Date("2026-08-04T08:00:00.000Z"),
            createdAt: new Date("2026-08-04T08:00:00.000Z"),
          },
        ],
      });
      const doc = buildIncidentExport(withTrail);
      // Oldest first, whatever kind: the crew count at 08:00 precedes the
      // pairing at 08:12, which is the comparison an investigator makes.
      expect(doc.timeline.map((entry) => entry.kind)).toEqual(["crew_count", "buddy_team"]);
      // Erasing the trail from an otherwise identical export changes the code.
      expect(doc.contentHash).not.toBe(
        buildIncidentExport({ ...withTrail, buddyTeamEvents: [] }).contentHash,
      );
    });

    it("never restates the live manifest's split-team alert — this document computes no verdict", () => {
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
              buddyTeam: {
                teamId: "t1",
                others: [{ kind: "diver" as const, bookingId: "b2", fullName: "Ben Cho" }],
              },
            },
            {
              ...diver("b2", "Ben Cho", notBack),
              buddyTeam: {
                teamId: "t1",
                others: [{ kind: "diver" as const, bookingId: "b1", fullName: "Ana Diaz" }],
              },
            },
          ],
        }),
      );
      const doc = buildIncidentExport(
        baseInput({
          manifests,
          events: [],
          crewCounts: [],
          buddyTeams: [teamOf("t1", [diverMember("b1", "Ana Diaz"), diverMember("b2", "Ben Cho")])],
        }),
      );
      const ana = doc.roster.find((entry) => entry.fullName === "Ana Diaz");

      expect(ana?.buddy?.members).toEqual([{ fullName: "Ben Cho", isCrew: false }]);
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
