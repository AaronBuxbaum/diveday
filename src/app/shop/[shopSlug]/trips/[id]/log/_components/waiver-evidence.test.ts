import { describe, expect, it } from "vitest";
import type { IncidentWaiverStatus } from "@/lib/incident-export";
import { matchesWaiverHeader, sharedWaiverHeader } from "./waiver-evidence";

function signed(overrides: Partial<IncidentWaiverStatus> = {}): IncidentWaiverStatus {
  return {
    state: "complete",
    signedAt: "2026-10-20T14:00:00.000Z",
    templateTitle: "Blue Mantis Diving Release",
    templateVersion: 3,
    signatureMethod: "in_person_attested",
    recordedByName: "Marcus Webb",
    medicalClearedAt: null,
    medicalClearedByName: null,
    ...overrides,
  } as IncidentWaiverStatus;
}

describe("sharedWaiverHeader", () => {
  it("states the release, version and recorder the boat's waivers share", () => {
    expect(sharedWaiverHeader([signed(), signed(), signed()])).toEqual({
      title: "Blue Mantis Diving Release",
      version: 3,
      signatureMethod: "in_person_attested",
      recordedByName: "Marcus Webb",
    });
  });

  it("keeps a diver whose version differs off the header, with their whole sentence", () => {
    const older = signed({ templateVersion: 2 });
    const header = sharedWaiverHeader([signed(), older, signed()]);
    expect(header?.version).toBe(3);
    expect(matchesWaiverHeader(signed(), header)).toBe(true);
    expect(matchesWaiverHeader(older, header)).toBe(false);
  });

  it("keeps a diver whose recorder differs off the header", () => {
    const other = signed({ recordedByName: "Ana Ruiz" });
    const header = sharedWaiverHeader([signed(), signed(), other]);
    expect(matchesWaiverHeader(other, header)).toBe(false);
  });

  it("never folds an unsigned, pending or withheld waiver into the header", () => {
    const header = sharedWaiverHeader([
      signed(),
      signed(),
      signed({ state: "awaiting_signature", signedAt: null }),
      null,
    ]);
    expect(header).not.toBeNull();
    expect(
      matchesWaiverHeader(signed({ state: "awaiting_signature", signedAt: null }), header),
    ).toBe(false);
    expect(matchesWaiverHeader(null, header)).toBe(false);
  });

  it("says nothing once when nothing is shared by two divers", () => {
    expect(sharedWaiverHeader([signed()])).toBeNull();
    expect(sharedWaiverHeader([signed(), signed({ templateVersion: 2 })])).toBeNull();
    expect(sharedWaiverHeader([])).toBeNull();
  });

  it("does not name a recorder for an online signature, and does not match one that has", () => {
    const online = signed({ signatureMethod: "electronic", recordedByName: "Marcus Webb" });
    const header = sharedWaiverHeader([online, online]);
    expect(header?.recordedByName).toBeNull();
    expect(matchesWaiverHeader(signed(), header)).toBe(false);
  });
});
