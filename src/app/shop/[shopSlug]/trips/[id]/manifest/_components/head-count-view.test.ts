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

  it("holds the passengers counted aboard against the boat's certificate", () => {
    const over = tripManifest({
      trip: { ...tripManifest().trip, certifiedPassengers: 12 },
      summary: { ...tripManifest().summary, totalDivers: 13, boarded: 13 },
    });
    expect(
      headCountView({ manifest: over, checkpoint: "departure", isDeparture: true }).overCertificate,
    ).toEqual({ aboard: 13, limit: 12 });

    const within = tripManifest({
      trip: { ...tripManifest().trip, certifiedPassengers: 12 },
      summary: { ...tripManifest().summary, totalDivers: 14, boarded: 12 },
    });
    // Booked past it is the Boat tab's line; the count speaks of bodies aboard.
    expect(
      headCountView({ manifest: within, checkpoint: "departure", isDeparture: true })
        .overCertificate,
    ).toBeNull();

    const noCertificate = tripManifest({
      summary: { ...tripManifest().summary, totalDivers: 40, boarded: 40 },
    });
    expect(
      headCountView({ manifest: noCertificate, checkpoint: "departure", isDeparture: true })
        .overCertificate,
    ).toBeNull();
  });

  // Dive-domain review D2: the certificate's total persons counts the crew too.
  it("holds passengers and crew counted aboard against total persons", () => {
    const aboard = {
      state: "boarded" as const,
      occurredAt: new Date(0),
      recordedByName: "Sol",
      note: null,
    };
    const crew = [
      crewMember({ id: "c-1", rollCall: aboard }),
      crewMember({ id: "c-2", rollCall: aboard }),
      crewMember({ id: "c-3" }),
    ] as ReturnType<typeof crewMember>[];
    const manifest = (boarded: number) =>
      tripManifest({
        trip: { ...tripManifest().trip, certifiedPassengers: 12, certifiedTotalPersons: 13 },
        summary: { ...tripManifest().summary, totalDivers: 12, boarded },
        crew,
      });
    const view = (boarded: number) =>
      headCountView({ manifest: manifest(boarded), checkpoint: "departure", isDeparture: true });
    // 12 passengers + 2 crew aboard is 14 souls; the crew member ashore is not.
    expect(view(12).overTotalPersons).toEqual({ aboard: 14, limit: 13 });
    expect(view(12).overCertificate).toBeNull();
    expect(view(11).overTotalPersons).toEqual(null);
    expect(
      headCountView({
        manifest: tripManifest({ summary: { ...tripManifest().summary, boarded: 40 }, crew }),
        checkpoint: "departure",
        isDeparture: true,
      }).overTotalPersons,
    ).toBeNull();
  });
});
