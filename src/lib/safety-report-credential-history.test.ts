import { describe, expect, it } from "vitest";
import {
  type SafetyCredential,
  type SafetyMonthInput,
  summarizeSafetyMonth,
} from "./safety-report";

const sailing = new Date("2026-10-03T13:00:00Z");
const input = (credentials: SafetyCredential[]): SafetyMonthInput => ({
  timeZone: "America/New_York",
  departures: [
    {
      tripId: "trip",
      title: "Boat",
      startsAt: sailing,
      endsAt: new Date("2026-10-03T17:00:00Z"),
      plannedDives: 1,
      diveMode: "boat",
      bookingIds: ["seat"],
      crew: [{ personId: "crew", tripRole: "captain", shopRoles: ["captain"] }],
    },
  ],
  diverEvents: [],
  crewEvents: [],
  credentials,
  unavailableCredentialPeople: new Set(["crew"]),
  personNames: new Map([["crew", "Crew"]]),
  certOverrides: 0,
});
const version = (
  event: NonNullable<SafetyCredential["event"]>,
  at: string,
  renewsAt: string,
): SafetyCredential => ({
  credentialId: "card",
  personId: "crew",
  kind: "captains_licence",
  issuedAt: "2024-01-01",
  renewsAt,
  event,
  recordedAt: new Date(at),
});

describe("historical crew credentials", () => {
  it("uses the start-day snapshot for provenance and the final local day for renewal", () => {
    const trip = input([]);
    const multiDayDeparture = {
      ...trip.departures[0],
      endsAt: new Date("2026-10-04T17:00:00Z"),
    };
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "captains_licence", issuedAt: "2024-01-01", renewsAt: "2026-10-03" },
      ],
      credentialSnapshotStartedAt: new Date("2026-10-03T14:00:00Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-03T14:00:01Z"),
    };

    const result = summarizeSafetyMonth({
      ...trip,
      departures: [multiDayDeparture],
      crewEvents: [mark],
    });

    expect(result.lapsedSailings).toEqual([
      expect.objectContaining({
        personId: "crew",
        kinds: ["captains_licence"],
        observationStartedAt: mark.credentialSnapshotStartedAt,
        observationCapturedAt: mark.credentialSnapshotCapturedAt,
      }),
    ]);
    expect(result.unknownCredentialSailings).toBe(0);
  });

  it("does not use a credential issued after the trip's scheduled start day", () => {
    const trip = input([
      {
        personId: "crew",
        kind: "captains_licence",
        issuedAt: "2026-10-04",
        renewsAt: null,
      },
    ]);
    const multiDayDeparture = {
      ...trip.departures[0],
      endsAt: new Date("2026-10-04T17:00:00Z"),
    };

    const result = summarizeSafetyMonth({
      ...trip,
      departures: [multiDayDeparture],
      unavailableCredentialPeople: new Set(),
    });

    expect(result.unrecordedSailings).toBe(1);
    expect(result.unrecordedCrew).toEqual([{ personId: "crew", name: "Crew", sailings: 1 }]);
  });

  it("does not infer a past lapse from unconfirmed transaction timestamps", () => {
    const result = summarizeSafetyMonth(
      input([
        version("created", "2026-09-01T12:00:00Z", "2026-10-02"),
        version("corrected", "2026-10-04T12:00:00Z", "2028-10-02"),
        version("deleted", "2026-10-05T12:00:00Z", "2028-10-02"),
      ]),
    );
    expect(result.lapsedSailings).toHaveLength(0);
    expect(result.unknownCredentialSailings).toBe(1);
  });
  it("excludes a legacy card and a card before its baseline instead of inventing history", () => {
    for (const card of [
      {
        personId: "crew",
        credentialId: "card",
        kind: "captains_licence",
        renewsAt: "2028-01-01",
        historyUnavailable: true,
      },
      version("baseline", "2026-10-04T12:00:00Z", "2028-01-01"),
    ]) {
      const result = summarizeSafetyMonth(input([card]));
      expect(result.unknownCredentialSailings).toBe(1);
      expect(result.checkedSailings).toBe(0);
      expect(result.lapsedSailings).toHaveLength(0);
      expect(result.unrecordedSailings).toBe(0);
    }
  });
  it("does not let a card created after the sailing answer it, even with a backdated issue date", () => {
    const result = summarizeSafetyMonth(
      input([version("created", "2026-10-04T12:00:00Z", "2028-01-01")]),
    );
    expect(result.unknownCredentialSailings).toBe(1);
    expect(result.unrecordedSailings).toBe(0);
    expect(result.lapsedSailings).toHaveLength(0);
  });
  it("treats an event at the departure instant as too late to establish the earlier state", () => {
    const result = summarizeSafetyMonth(
      input([
        version("created", "2026-09-01T12:00:00Z", "2026-10-02"),
        version("renewed", "2026-10-03T13:00:00Z", "2028-10-02"),
      ]),
    );
    expect(result.unknownCredentialSailings).toBe(1);
    expect(result.lapsedSailings).toHaveLength(0);
  });
  it("uses a same-day live boarding mark for a lapse even when it follows the scheduled time", () => {
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "captains_licence", issuedAt: "2024-01-01", renewsAt: "2026-10-02" },
      ],
      credentialSnapshotStartedAt: new Date("2026-10-03T14:00:00Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-03T14:00:01Z"),
    };
    // The current credential was renewed later; only the sailing-day snapshot
    // answers for this departure.
    const result = summarizeSafetyMonth({
      ...input([version("renewed", "2026-10-05T12:00:00Z", "2028-10-02")]),
      crewEvents: [mark],
    });
    expect(result.lapsedSailings).toHaveLength(1);
    expect(result.lapsedSailings[0]).toMatchObject({
      observationStartedAt: mark.credentialSnapshotStartedAt,
      observationCapturedAt: mark.credentialSnapshotCapturedAt,
    });
    expect(result.unknownCredentialSailings).toBe(0);
  });
  it("leaves a sailing unavailable when a live boarding snapshot is from another local day", () => {
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "captains_licence", issuedAt: "2024-01-01", renewsAt: "2026-10-02" },
      ],
      // 2026-10-04 in New York; the trip sailed on 2026-10-03.
      credentialSnapshotStartedAt: new Date("2026-10-04T14:00:00Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-04T14:00:01Z"),
    };
    const result = summarizeSafetyMonth({
      ...input([version("renewed", "2026-10-05T12:00:00Z", "2028-10-02")]),
      crewEvents: [mark],
    });
    expect(result.unknownCredentialSailings).toBe(1);
    expect(result.checkedSailings).toBe(0);
    expect(result.lapsedSailings).toHaveLength(0);
  });
  it("does not infer a historical role from today's assignment", () => {
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "first_aid_cpr", issuedAt: "2024-01-01", renewsAt: "2028-01-01" },
      ],
      credentialSnapshotStartedAt: new Date("2026-10-03T14:00:00Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-03T14:00:01Z"),
    };
    const result = summarizeSafetyMonth({ ...input([]), crewEvents: [mark] });
    expect(result.unrecordedSailings).toBe(0);
    expect(result.unknownCredentialSailings).toBe(0);
  });
  it("leaves a future-issued captured card unavailable", () => {
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "captains_licence", issuedAt: "2026-10-04", renewsAt: "2028-01-01" },
      ],
      credentialSnapshotStartedAt: new Date("2026-10-03T14:00:00Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-03T14:00:01Z"),
    };
    const result = summarizeSafetyMonth({ ...input([]), crewEvents: [mark] });
    expect(result.unknownCredentialSailings).toBe(1);
    expect(result.unrecordedSailings).toBe(0);
  });
  it("leaves an observation spanning midnight unavailable", () => {
    const mark = {
      tripId: "trip",
      subjectId: "crew",
      checkpoint: "departure",
      status: "boarded" as const,
      credentialSnapshot: [
        { kind: "captains_licence", issuedAt: "2024-01-01", renewsAt: "2026-10-02" },
      ],
      credentialSnapshotStartedAt: new Date("2026-10-03T03:59:59Z"),
      credentialSnapshotCapturedAt: new Date("2026-10-03T04:00:01Z"),
    };
    const result = summarizeSafetyMonth({ ...input([]), crewEvents: [mark] });
    expect(result.unknownCredentialSailings).toBe(1);
    expect(result.lapsedSailings).toHaveLength(0);
  });
});
