import { describe, expect, it } from "vitest";
import {
  buildTripManifest,
  type ManifestBuddyTeam,
  type ManifestDiverInput,
  type RollCallRecord,
} from "./manifests";

const trip = {
  id: "trip-1",
  title: "Two-Tank Reef",
  startsAt: new Date("2026-07-20T12:00:00.000Z"),
  endsAt: new Date("2026-07-20T16:00:00.000Z"),
  plannedDives: 2,
};

const at = (state: RollCallRecord["state"]): RollCallRecord => ({
  state,
  occurredAt: new Date("2026-07-20T11:45:00.000Z"),
  recordedByName: "Dana Reyes",
});
const boardedAt = () => at("boarded");
const notBoardedAt = () => at("not_boarded");

const diver = (
  bookingId: string,
  fullName: string,
  extra: Partial<ManifestDiverInput> = {},
): ManifestDiverInput => ({
  bookingId,
  fullName,
  email: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  readiness: { status: "ready", blockers: [] },
  rentalFit: { state: "own_kit" as const },
  nitroxRequested: false,
  checkedIn: false,
  ...extra,
});
const team = (teamId: string, others: ManifestBuddyTeam["others"]) => ({ teamId, others });
const otherDiver = (bookingId: string, fullName: string) =>
  ({ kind: "diver", bookingId, fullName }) as const;

describe("buddy teams — who is missing, by name (ADR 20260804-buddy-teams)", () => {
  it("names the teammates who raise the alert, and nobody on a row without one", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [
            otherDiver("booking-lena", "Lena Fischer"),
            otherDiver("booking-ravi", "Ravi Patel"),
            // A stale reference is dropped, never named.
            otherDiver("booking-gone", "Ghost Person"),
          ]),
        }),
        // Back aboard: not the one the alert is about.
        diver("booking-lena", "Lena Fischer", { rollCall: boardedAt() }),
        diver("booking-ravi", "Ravi Patel", { rollCall: notBoardedAt() }),
      ],
    });
    const byId = (id: string) => manifest.divers.find((d) => d.bookingId === id);
    expect(byId("booking-tom")?.buddyMissing).toEqual(["Ravi Patel"]);
    expect(byId("booking-lena")?.buddyMissing).toEqual([]);
    expect(byId("booking-ravi")?.buddyMissing).toEqual([]);
  });

  it("names no one at the dock for a teammate recorded ashore, or when the row is not aboard", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "departure",
      crew: [],
      divers: [
        diver("booking-tom", "Tom Okafor", {
          rollCall: boardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-lena", "Lena Fischer")]),
        }),
        diver("booking-lena", "Lena Fischer", {
          rollCall: notBoardedAt(),
          buddyTeam: team("team-1", [otherDiver("booking-tom", "Tom Okafor")]),
        }),
      ],
    });
    const byId = (id: string) => manifest.divers.find((d) => d.bookingId === id);
    expect(byId("booking-tom")?.buddyAlert).toBeNull();
    expect(byId("booking-tom")?.buddyMissing).toEqual([]);
    expect(byId("booking-lena")?.buddyMissing).toEqual([]);
  });
});
