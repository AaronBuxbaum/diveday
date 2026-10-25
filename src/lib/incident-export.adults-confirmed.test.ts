import { describe, expect, it } from "vitest";
import { buildIncidentExport } from "./incident-export";
import { baseInput, diver, manifestsFor } from "./incident-export-test-fixtures";

/**
 * Issue 2808: a team "Team up each party" made on a staffer's word that
 * everyone in it is 18 or over says so on its trail line, inside the integrity
 * code; a line with no attestation carries no field, so older exports hash as
 * they did.
 */
describe("the buddy trail's 18-or-over attestation", () => {
  const PAIRED_AT = new Date("2026-08-04T08:12:00.000Z");
  const event = {
    teamId: "t1",
    action: "formed" as const,
    memberNames: ["Ana Diaz", "Ben Cho"],
    recordedByName: "Sol Marin",
    occurredAt: PAIRED_AT,
    createdAt: PAIRED_AT,
  };
  const exportWith = (events: (typeof event & { adultsConfirmed?: boolean })[]) =>
    buildIncidentExport(
      baseInput({
        manifests: manifestsFor([diver("b1", "Ana Diaz"), diver("b2", "Ben Cho")]),
        events: [],
        buddyTeamEvents: events,
      }),
    );

  it("carries the attestation on the line it was given for", () => {
    const attested = exportWith([{ ...event, adultsConfirmed: true }]);
    const plain = exportWith([{ ...event, adultsConfirmed: false }]);
    const line = (doc: typeof plain) => doc.timeline.find((entry) => entry.kind === "buddy_team");
    expect(line(attested)).toMatchObject({ adultsConfirmed: true });
    expect(line(plain)).not.toHaveProperty("adultsConfirmed");
    expect(attested.contentHash).not.toBe(plain.contentHash);
    expect(exportWith([event]).contentHash).toBe(plain.contentHash);
  });
});
