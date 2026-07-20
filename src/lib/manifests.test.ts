import { describe, expect, it } from "vitest";
import {
  buildTripManifest,
  isRollCallCheckpoint,
  rollCallCheckpointLabel,
  rollCallCheckpoints,
  rollCallLabel,
} from "./manifests";

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date("2026-07-20T16:00:00.000Z"),
  plannedDives: 2,
};

describe("buildTripManifest", () => {
  it("retains every supplied booking and fails closed when its readiness lookup is unavailable", () => {
    const manifest = buildTripManifest({
      trip,
      crew: [{ fullName: "Dana Reyes", roles: ["captain"] }],
      divers: [
        {
          bookingId: "booking-ready",
          fullName: "Priya Sharma",
          email: "priya@example.com",
          emergencyContactName: "Asha Sharma",
          emergencyContactPhone: "+1-305-555-0101",
          readiness: { status: "ready", blockers: [] },
          rentalFit: { state: "rents" as const, text: "BCD M, Wetsuit 5mm M" },
          nitroxRequested: true,
          rollCall: {
            state: "boarded",
            occurredAt: new Date("2026-07-20T11:45:00.000Z"),
            recordedByName: "Dana Reyes",
            note: null,
          },
        },
        {
          bookingId: "booking-unknown",
          fullName: "Omar Haddad",
          email: null,
          emergencyContactName: null,
          emergencyContactPhone: null,
          rentalFit: { state: "not_recorded" as const, text: "No fit on file — not asked yet" },
          nitroxRequested: false,
        },
      ],
    });

    expect(manifest.divers).toHaveLength(2);
    expect(manifest.divers[1]?.readiness.blockers).toContainEqual(
      expect.objectContaining({ code: "readiness_unavailable" }),
    );
    expect(manifest.summary).toEqual({
      totalDivers: 2,
      ready: 1,
      blocked: 1,
      boarded: 1,
      awaiting: 1,
    });
  });

  it("uses explicit words for every roll-call state", () => {
    expect(rollCallLabel(undefined)).toBe("Awaiting roll call");
    expect(
      rollCallLabel({
        state: "not_boarded",
        occurredAt: new Date(),
        recordedByName: "Dana Reyes",
        note: "Stayed ashore",
      }),
    ).toBe("Not boarded");
  });

  it("builds bounded departure and after-dive checkpoints", () => {
    expect(rollCallCheckpoints(2)).toEqual(["departure", "after_dive_1", "after_dive_2"]);
    expect(isRollCallCheckpoint("after_dive_2", 2)).toBe(true);
    expect(isRollCallCheckpoint("after_dive_3", 2)).toBe(false);
    expect(rollCallCheckpointLabel("after_dive_2")).toBe("After dive 2");
  });
});
