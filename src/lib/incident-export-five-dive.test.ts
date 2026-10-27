import { describe, expect, it } from "vitest";
import { buildIncidentExport } from "./incident-export";
import { baseInput, diver, TRIP } from "./incident-export-test-fixtures";
import { buildTripManifest, rollCallCheckpoints } from "./manifests";

describe("a five-dive departure log", () => {
  it("preserves the fifth after-dive head count and its missing-diver status", () => {
    const trip = { ...TRIP, plannedDives: 5 };
    const missing = {
      state: "not_boarded" as const,
      occurredAt: new Date("2026-08-04T17:00:00.000Z"),
      recordedByName: "Captain Sol",
    };
    const manifests = rollCallCheckpoints(5).map((checkpoint) =>
      buildTripManifest({
        trip,
        checkpoint,
        crew: [],
        divers: [diver("b1", "Ana Diaz", checkpoint === "after_dive_5" ? missing : undefined)],
      }),
    );
    const doc = buildIncidentExport(baseInput({ manifests, events: [] }));
    expect(doc.meta.checkpoints).toEqual([
      "departure",
      "after_dive_1",
      "after_dive_2",
      "after_dive_3",
      "after_dive_4",
      "after_dive_5",
    ]);
    expect(doc.roster[0]?.rollCall[5]).toMatchObject({
      checkpoint: "after_dive_5",
      label: "not_back_aboard",
      recordedByName: "Captain Sol",
    });
  });
});
