import { describe, expect, it } from "vitest";
import { boardedAt, notBoardedAt, trip } from "./manifest-test-fixtures";
import {
  buildTripManifest,
  isTurnedAwayOffBoat,
  type ManifestDiverInput,
  type RollCallRecord,
} from "./manifests";

/**
 * **A seat the desk turned away is off the boat for every head count** (issue
 * #2907). The desk stood in front of this diver and refused them, so nobody at
 * the rail is waiting for them: a roll call that can never reach "0 awaiting"
 * is a count a captain learns to ignore. One predicate, `isTurnedAwayOffBoat`,
 * decides it for every count; a result anybody at the boat records wins over
 * the desk, as it does for every released seat.
 */
const seat = (bookingId: string, extra: Partial<ManifestDiverInput> = {}): ManifestDiverInput => ({
  bookingId,
  fullName: bookingId,
  email: null,
  emergencyContactName: null,
  emergencyContactPhone: null,
  readiness: { status: "ready", blockers: [] },
  rentalFit: { state: "own_kit" as const },
  nitroxRequested: false,
  checkedIn: false,
  ...extra,
});

const turnedAway = (bookingId: string, extra: Partial<ManifestDiverInput> = {}) =>
  seat(bookingId, {
    notHere: true,
    turnedAway: true,
    readiness: { status: "blocked", blockers: [{ code: "waiver_not_sent" }] },
    ...extra,
  });

/** Ten seats each carrying `rollCall`, and Priya, turned away for her waiver. */
function boatOfEleven(rollCall: RollCallRecord | undefined) {
  return [
    ...Array.from({ length: 10 }, (_, index) => seat(`booking-${index}`, { rollCall })),
    turnedAway("booking-priya"),
  ];
}

describe("isTurnedAwayOffBoat", () => {
  it("is true only for a turned-away seat nobody at the boat has spoken for", () => {
    expect(isTurnedAwayOffBoat({ turnedAway: true, rollCall: undefined })).toBe(true);
    expect(isTurnedAwayOffBoat({ turnedAway: true, rollCall: boardedAt() })).toBe(false);
    expect(isTurnedAwayOffBoat({ turnedAway: true, rollCall: notBoardedAt() })).toBe(false);
    // A plain "Not here" is not a turn-away: nobody saw that diver, so the
    // boat still has to say where they are.
    const writtenOff = seat("booking-gone", { notHere: true });
    expect(isTurnedAwayOffBoat(writtenOff)).toBe(false);
    expect(isTurnedAwayOffBoat({ rollCall: undefined })).toBe(false);
    expect(isTurnedAwayOffBoat({ turnedAway: false, rollCall: undefined })).toBe(false);
  });
});

describe("a trip of eleven with one turned away and ten aboard (#2907)", () => {
  it("reads 10 of 10 aboard, 0 awaiting, at the dock", () => {
    const manifest = buildTripManifest({ trip, crew: [], divers: boatOfEleven(boardedAt()) });
    expect(manifest.summary).toMatchObject({
      totalDivers: 10,
      boarded: 10,
      awaiting: 0,
      unaccountedFor: 0,
      notHere: 0,
      blocked: 0,
      ready: 10,
    });
    expect(manifest.summary.byType).toEqual({ diver: 10, snorkeler: 0, rider: 0 });
    expect(manifest.completeness.diversAccountedFor).toBe(true);
    expect(manifest.completeness.reason).not.toBe("divers_awaiting");
    // She keeps her row: the crew can still see who the desk sent home.
    expect(manifest.divers).toHaveLength(11);
    expect(manifest.divers.find((d) => d.bookingId === "booking-priya")?.turnedAway).toBe(true);
  });

  it("reads 0 awaiting after a dive too", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: boatOfEleven(boardedAt()),
    });
    expect(manifest.summary).toMatchObject({ totalDivers: 10, awaiting: 0, unaccountedFor: 0 });
    expect(manifest.completeness.diversAccountedFor).toBe(true);
  });

  it("keeps the count row summing to the people the boat counts", () => {
    const divers = [
      ...boatOfEleven(undefined).slice(0, 8),
      seat("booking-left", { rollCall: notBoardedAt() }),
      turnedAway("booking-priya"),
    ];
    const { summary } = buildTripManifest({ trip, crew: [], divers });
    expect(summary.boarded + summary.notBoarded + summary.awaiting).toBe(summary.totalDivers);
    expect(summary.totalDivers).toBe(9);
    expect(summary.awaiting).toBe(8);
  });
});

describe("a turned-away seat the boat has since answered for", () => {
  it("counts a diver the rail boarded anyway, even on a stale snapshot", () => {
    // Boarding reclaims the seat, so the next read says turnedAway false; a
    // copy that still carries the flag must not subtract a body on the deck.
    const manifest = buildTripManifest({
      trip,
      crew: [],
      divers: [turnedAway("booking-priya", { rollCall: boardedAt() })],
    });
    expect(manifest.summary).toMatchObject({ totalDivers: 1, boarded: 1, awaiting: 0 });
  });

  it("counts one the crew recorded not back aboard after a dive: that is a missing person", () => {
    const manifest = buildTripManifest({
      trip,
      checkpoint: "after_dive_1",
      crew: [],
      divers: [
        seat("booking-ok", { rollCall: boardedAt() }),
        turnedAway("booking-priya", {
          rollCall: notBoardedAt(),
        }),
      ],
    });
    expect(manifest.summary).toMatchObject({ totalDivers: 2, notBackAboard: 1, unaccountedFor: 1 });
    expect(manifest.completeness.diversAccountedFor).toBe(false);
    expect(manifest.completeness.reason).toBe("divers_not_back_aboard");
  });
});

describe("what a turn-away never does", () => {
  it("never closes a checkpoint for a plain no-show nobody at the boat has answered for", () => {
    const manifest = buildTripManifest({
      trip,
      crew: [],
      divers: [
        seat("booking-ok", { rollCall: boardedAt() }),
        seat("booking-gone", { notHere: true }),
      ],
    });
    expect(manifest.summary).toMatchObject({ totalDivers: 2, awaiting: 1, notHere: 1 });
    expect(manifest.completeness.diversAccountedFor).toBe(false);
  });

  it("never makes a boat of only turned-away seats read complete", () => {
    const manifest = buildTripManifest({
      trip,
      crew: [],
      divers: [turnedAway("booking-a"), turnedAway("booking-b")],
    });
    expect(manifest.summary).toMatchObject({ totalDivers: 0, awaiting: 0 });
    expect(manifest.completeness.complete).toBe(false);
    expect(manifest.completeness.reason).toBe("no_divers");
  });

  it("never hides a diver still to be counted beside a turn-away", () => {
    const divers = [
      ...boatOfEleven(boardedAt()).slice(0, 9),
      seat("booking-late"),
      turnedAway("booking-priya"),
    ];
    const manifest = buildTripManifest({ trip, crew: [], divers });
    expect(manifest.summary).toMatchObject({ totalDivers: 10, awaiting: 1 });
    expect(manifest.completeness.reason).toBe("divers_awaiting");
  });
});
