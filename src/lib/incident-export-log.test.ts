import { describe, expect, it } from "vitest";
import {
  buildIncidentExport,
  hasRollCallEntries,
  incidentExportContentHash,
  rosterChangeFromActivity,
} from "./incident-export";
import { baseInput, completedWaiver, TRIP, verifiedCard } from "./incident-export-test-fixtures";

/**
 * **Seats changed after the boat was due out, and the reports the shop holds**
 * (safety sheet 2026-10-15, items 5 and 7). Both join the document and its
 * integrity code, and a log printed before they did still checks: the code
 * carries its recipe's version.
 */
describe("roster changes and incident reports on the departure log", () => {
  /** The version-1 code of `baseInput()`, as every log before 2026-10-16 printed it. */
  const BASE_V1_HASH = "bdbb04ff72e275ed0898643f1a983a08c2eaea43cd41c2c5176908b300452ad4";

  const AFTER_START = new Date("2026-08-04T13:20:00.000Z");
  const removal = {
    action: "removed" as const,
    subjectName: "Ben Cho",
    recordedByName: "Rae Owner",
    occurredAt: AFTER_START,
  };
  const draft = {
    reportId: "report-1",
    status: "draft" as const,
    kind: null,
    severity: null,
    filedAt: null,
    filedByName: null,
    addendaCount: 0,
    createdAt: "2026-08-04T15:00:00.000Z",
    createdByName: "Sal Rivera",
    deletedAt: null,
    deletedByName: null,
  };

  it("keeps an old printout's code: version 1 is the recipe it was sealed with", () => {
    const plain = buildIncidentExport(baseInput());
    expect(incidentExportContentHash(plain, 1)).toBe(BASE_V1_HASH);
  });

  it("gives a version-1 code to a log with nothing version 2 added, whenever it was made", () => {
    // Domain re-review 2026-10-16, item 4: main still prints version 1 until
    // this ships, so a fixed cutover date refused genuine printouts. A log
    // made today of a departure with no late seat change and no report is
    // exactly what version 1 sealed.
    const { contentHash: _code, ...body } = buildIncidentExport(
      baseInput({ generatedAt: new Date("2026-11-30T09:00:00.000Z") }),
    );
    expect(() => incidentExportContentHash(body, 1)).not.toThrow();
  });

  it("refuses a version-1 code for a log holding anything version 2 added", () => {
    // Version 1 leaves out the seat changes and the reports, so a version-1
    // code for such a log would seal a document missing both.
    const v1 = (input: Parameters<typeof baseInput>[0]) => {
      const { contentHash: _code, ...body } = buildIncidentExport(baseInput(input));
      return () => incidentExportContentHash(body, 1);
    };
    expect(v1({ rosterChanges: [removal] })).toThrow(/version 1/);
    expect(v1({ incidentReports: [draft] })).toThrow(/version 1/);
    // A crew line is a roster line too.
    expect(v1({ rosterChanges: [{ ...removal, action: "crew_removed" }] })).toThrow(/version 1/);
    // A change before the boat was due out is not on the log, so not v2-only.
    expect(
      v1({ rosterChanges: [{ ...removal, occurredAt: new Date("2026-08-04T12:00:00.000Z") }] }),
    ).not.toThrow();
  });

  it("refuses a version-1 code for a log dated before something it records", () => {
    // A backdated generatedAt is not a way round the refusal above: a log
    // cannot record what happened after it was made.
    const { contentHash: _code, ...body } = buildIncidentExport(
      baseInput({ generatedAt: new Date("2026-08-04T12:44:59.999Z") }),
    );
    expect(() => incidentExportContentHash(body, 1)).toThrow(/version 1/);
    const { contentHash: _same, ...onTime } = buildIncidentExport(
      baseInput({ generatedAt: new Date("2026-08-04T12:45:00.000Z") }),
    );
    expect(() => incidentExportContentHash(onTime, 1)).not.toThrow();
  });

  it("states a waiver as it stood when the boat was due out, so the code does not move with the print date", () => {
    // Domain re-review 2026-10-16, item 3: a link that lapsed between two
    // printings changed the version-2 code under unchanged records.
    const pending = completedWaiver({
      status: "pending",
      signedAt: null,
      completedAt: null,
      expiresAt: new Date("2026-08-05T09:00:00.000Z"),
    });
    const at = (generatedAt: Date) =>
      buildIncidentExport(
        baseInput({
          generatedAt,
          diverEvidence: [
            {
              bookingId: "b1",
              certifications: [verifiedCard()],
              specialtyCertifications: [],
              nitroxCertifications: [],
              waiver: pending,
            },
          ],
        }),
      );
    const before = at(new Date("2026-08-04T20:00:00.000Z"));
    const after = at(new Date("2026-08-06T20:00:00.000Z"));
    expect(after.contentHash).toBe(before.contentHash);
    expect(after.roster[0]?.waiver?.state).toBe("awaiting_signature");
    // Lapsed before the boat was due out (12:45): expired, however late it prints.
    const lapsed = buildIncidentExport(
      baseInput({
        diverEvidence: [
          {
            bookingId: "b1",
            certifications: [],
            specialtyCertifications: [],
            nitroxCertifications: [],
            waiver: { ...pending, expiresAt: new Date("2026-08-04T12:44:00.000Z") },
          },
        ],
      }),
    );
    expect(lapsed.roster[0]?.waiver?.state).toBe("expired");
  });

  it("seals version 3 by default, names it, and never matches an earlier code", () => {
    const doc = buildIncidentExport(baseInput());
    expect(doc.hashVersion).toBe(3);
    expect(doc.contentHash).not.toBe(BASE_V1_HASH);
    const { contentHash, ...body } = doc;
    expect(incidentExportContentHash(body)).toBe(contentHash);
    expect(incidentExportContentHash(body, 3)).toBe(contentHash);
    expect(incidentExportContentHash(body, 2)).not.toBe(contentHash);
  });

  it("lists a seat change from the scheduled start on, in time order, and none before", () => {
    const doc = buildIncidentExport(
      baseInput({
        rosterChanges: [
          // Before roll call began the roster is still being made: not this log's.
          { ...removal, action: "added", occurredAt: new Date("2026-08-04T12:44:59.000Z") },
          { ...removal, action: "moved_here", occurredAt: TRIP.startsAt },
          removal,
        ],
      }),
    );
    const changes = doc.timeline.filter((entry) => entry.kind === "roster_change");
    expect(changes).toEqual([
      {
        kind: "roster_change",
        occurredAt: TRIP.startsAt.toISOString(),
        checkpoint: null,
        action: "moved_here",
        subjectName: "Ben Cho",
        recordedByName: "Rae Owner",
      },
      {
        kind: "roster_change",
        occurredAt: AFTER_START.toISOString(),
        checkpoint: null,
        action: "removed",
        subjectName: "Ben Cho",
        recordedByName: "Rae Owner",
      },
    ]);
    // Interleaved with the head count by time: the boarding at 12:45 is first.
    expect(doc.timeline[0]?.kind).toBe("diver");
  });

  it("lists a seat taken off after departure roll call began, though before the start", () => {
    // Start 13:00; boarded at the departure roll call 12:45; taken off 12:52.
    // A boat that leaves early has left (domain reviews 2026-10-16): without
    // this line the log shows a boarding and no seat (auditor item 4).
    const early = { ...removal, occurredAt: new Date("2026-08-04T12:52:00.000Z") };
    const doc = buildIncidentExport(baseInput({ rosterChanges: [early] }));
    expect(doc.timeline).toContainEqual(
      expect.objectContaining({ kind: "roster_change", occurredAt: "2026-08-04T12:52:00.000Z" }),
    );
  });

  it("says a late line was erased at a person's request, and names nobody", () => {
    // A late removal whose diver was since erased is still a seat change the
    // head count has to account for (auditor item 12).
    const doc = buildIncidentExport(
      baseInput({
        rosterChanges: [
          rosterChangeFromActivity({ code: "redacted", params: {}, occurredAt: AFTER_START }),
        ].flatMap((change) => (change ? [change] : [])),
      }),
    );
    expect(doc.timeline.filter((entry) => entry.kind === "roster_change")).toEqual([
      {
        kind: "roster_change",
        occurredAt: AFTER_START.toISOString(),
        checkpoint: null,
        action: "erased",
        subjectName: "",
        recordedByName: "",
      },
    ]);
  });

  it("says there are no roll-call entries when only seat lines stand on the timeline", () => {
    const doc = buildIncidentExport(baseInput({ events: [], rosterChanges: [removal] }));
    expect(doc.timeline).toHaveLength(1);
    expect(hasRollCallEntries(doc.timeline)).toBe(false);
    expect(hasRollCallEntries(buildIncidentExport(baseInput()).timeline)).toBe(true);
  });

  it("changes the code when a seat changes after the start, and not for one before", () => {
    const plain = buildIncidentExport(baseInput()).contentHash;
    expect(buildIncidentExport(baseInput({ rosterChanges: [removal] })).contentHash).not.toBe(
      plain,
    );
    const early = { ...removal, occurredAt: new Date("2026-08-03T09:00:00.000Z") };
    expect(buildIncidentExport(baseInput({ rosterChanges: [early] })).contentHash).toBe(plain);
  });

  it("lists the reports, and seals what is printed, not the report's id", () => {
    const doc = buildIncidentExport(baseInput({ incidentReports: [draft] }));
    expect(doc.incidentReports).toEqual([draft]);
    expect(doc.contentHash).not.toBe(buildIncidentExport(baseInput()).contentHash);
    const renamed = buildIncidentExport(
      baseInput({ incidentReports: [{ ...draft, reportId: "report-OTHER" }] }),
    );
    expect(renamed.contentHash).toBe(doc.contentHash);
    const filed = buildIncidentExport(
      baseInput({
        incidentReports: [
          {
            ...draft,
            status: "filed",
            kind: "injury",
            severity: "moderate",
            filedAt: "2026-08-04T16:00:00.000Z",
            filedByName: "Sal Rivera",
            addendaCount: 1,
          },
        ],
      }),
    );
    expect(filed.contentHash).not.toBe(doc.contentHash);
  });

  it("reads the activity trail's seat lines, and nothing else", () => {
    const at = AFTER_START;
    const line = (code: string, params: Record<string, string>) =>
      rosterChangeFromActivity({ code, params, occurredAt: at });
    expect(line("seat_added_walk_in", { actor: "Rae Owner", diver: "Ben Cho" })).toEqual({
      action: "added",
      subjectName: "Ben Cho",
      recordedByName: "Rae Owner",
      occurredAt: at,
    });
    expect(line("seat_moved_away", { actor: "Rae Owner", diver: "Ben Cho" })?.action).toBe(
      "moved_away",
    );
    // A diver cancelling their own seat is the only name on the line.
    expect(line("seat_self_cancelled", { actor: "Ben Cho" })).toMatchObject({
      action: "removed",
      subjectName: "Ben Cho",
      recordedByName: "Ben Cho",
    });
    // A crew member put on or taken off the boat changes the head count too
    // (domain review 2026-10-16).
    expect(line("crew_assigned", { actor: "Rae Owner", crew: "Ana Ruiz" })).toMatchObject({
      action: "crew_added",
      subjectName: "Ana Ruiz",
    });
    expect(line("crew_removed", { actor: "Rae Owner", crew: "Ana Ruiz" })?.action).toBe(
      "crew_removed",
    );
    // A no-show changes no seat, and a note is not a seat. An erased line is
    // read as one only where the query proves it named someone by record.
    expect(line("booking_no_show", { actor: "Rae Owner", diver: "Ben Cho" })).toBeNull();
    expect(line("toString", {})).toBeNull();
  });

  it("reads a turn-away at the desk as a seat line with its reason category", () => {
    // A seat freed at the desk after the boat was due out changes the head
    // count like a removal does, and says why by category only (H-135).
    const turned = rosterChangeFromActivity({
      code: "booking_turned_away",
      params: { actor: "Rae Owner", diver: "Ben Cho", reason: "card" },
      occurredAt: AFTER_START,
    });
    expect(turned).toEqual({
      action: "turned_away",
      subjectName: "Ben Cho",
      recordedByName: "Rae Owner",
      reason: "card",
      occurredAt: AFTER_START,
    });
    // A category the code does not know is not printed as one.
    expect(
      rosterChangeFromActivity({
        code: "booking_turned_away",
        params: { actor: "Rae Owner", diver: "Ben Cho", reason: "<b>sick</b>" },
        occurredAt: AFTER_START,
      }),
    ).not.toHaveProperty("reason");
    const doc = buildIncidentExport(baseInput({ rosterChanges: turned ? [turned] : [] }));
    expect(doc.timeline.filter((entry) => entry.kind === "roster_change")).toEqual([
      {
        kind: "roster_change",
        occurredAt: AFTER_START.toISOString(),
        checkpoint: null,
        action: "turned_away",
        subjectName: "Ben Cho",
        recordedByName: "Rae Owner",
        reason: "card",
      },
    ]);
  });
});
