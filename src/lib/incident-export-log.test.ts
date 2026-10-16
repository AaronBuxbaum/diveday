import { describe, expect, it } from "vitest";
import {
  buildIncidentExport,
  incidentExportContentHash,
  rosterChangeFromActivity,
} from "./incident-export";
import { baseInput, TRIP } from "./incident-export-test-fixtures";

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
    // The new facts do not move a version-1 code: they are not in its recipe.
    const fuller = buildIncidentExport(
      baseInput({ rosterChanges: [removal], incidentReports: [draft] }),
    );
    expect(incidentExportContentHash(fuller, 1)).toBe(BASE_V1_HASH);
  });

  it("seals version 2 by default, names it, and never matches a version-1 code", () => {
    const doc = buildIncidentExport(baseInput());
    expect(doc.hashVersion).toBe(2);
    expect(doc.contentHash).not.toBe(BASE_V1_HASH);
    const { contentHash, ...body } = doc;
    expect(incidentExportContentHash(body)).toBe(contentHash);
    expect(incidentExportContentHash(body, 2)).toBe(contentHash);
  });

  it("lists a seat change from the scheduled start on, in time order, and none before", () => {
    const doc = buildIncidentExport(
      baseInput({
        rosterChanges: [
          // Before the start the roster is still being made: not this log's.
          { ...removal, action: "added", occurredAt: new Date("2026-08-04T12:59:59.000Z") },
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
    // A no-show changes no seat; an erased line and a note are not seats.
    expect(line("booking_no_show", { actor: "Rae Owner", diver: "Ben Cho" })).toBeNull();
    expect(line("redacted", {})).toBeNull();
    expect(line("toString", {})).toBeNull();
  });
});
