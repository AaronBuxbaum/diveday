import { describe, expect, it } from "vitest";
import { diver, notBackAt } from "./diver-roll-call-test-fixtures";
import { headCountView } from "./head-count-view";
import { crewMember, tripManifest } from "./manifest-page-test-fixtures";

describe("headCountView", () => {
  it("names who is recorded not back aboard, divers and crew alike", () => {
    const manifest = tripManifest({
      checkpoint: "after_dive_1",
      divers: [
        diver({ bookingId: "b-1", fullName: "Ana Ruiz" }),
        diver({ bookingId: "b-2", fullName: "Diego Marín", rollCall: notBackAt() }),
      ],
      crew: [crewMember({ rollCall: notBackAt() })],
    });
    const view = headCountView({ manifest, checkpoint: "after_dive_1", isDeparture: false });
    expect(view.notBackAboardDivers).toEqual([{ bookingId: "b-2", fullName: "Diego Marín" }]);
    expect(view.notBackAboardCrew).toEqual([
      { id: "00000000-0000-4000-8000-0000000000c1", fullName: "Keiko Tanaka" },
    ]);
  });

  it("counts no split team at the dock, where nobody has been in the water", () => {
    const view = headCountView({
      manifest: tripManifest({ checkpoint: "departure" }),
      checkpoint: "departure",
      isDeparture: true,
    });
    expect(view.separatedTeams).toBe(0);
    expect(view.notBackAboardDivers).toEqual([]);
  });
});
