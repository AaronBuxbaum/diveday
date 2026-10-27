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
});
