import { describe, expect, it } from "vitest";
import { EMPTY_EMERGENCY_REFERENCE } from "./emergency-reference";
import type { TripManifest } from "./manifests";
import { serializeManifests } from "./offline-manifests";

/**
 * **A training dive rides the dock copy** (issue #2275, build review T4/T5):
 * the crew boarding from a saved copy read the same two facts the live
 * manifest prints — which course the dive counts toward, with the warning when
 * no instructor is on the crew, and who cleared a mark with forms unsigned.
 */
const shop = {
  slug: "blue-mantis",
  name: "Blue Mantis",
  timezone: "America/New_York",
  emergencyReference: EMPTY_EMERGENCY_REFERENCE,
};

function manifestWith(diver: Partial<TripManifest["divers"][number]>): TripManifest {
  return {
    trip: {
      id: "trip-1",
      title: "Afternoon reef charter",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 1,
    },
    checkpoint: "departure",
    crew: [],
    completeness: {
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: false,
      reason: "divers_awaiting",
      crewReason: "crew_none_assigned",
      crewCounts: { crewAwaiting: 0, crewNotBackAboard: 0, crewAshore: 0, crewAssigned: 0 },
    },
    divers: [
      {
        bookingId: "booking-1",
        fullName: "Maya Ortiz",
        email: "maya@example.com",
        emergencyContactName: null,
        emergencyContactPhone: null,
        readiness: { status: "ready", blockers: [] },
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        checkedIn: false,
        rollCall: undefined,
        buddyAlert: null,
        ...diver,
      },
    ],
    summary: {
      totalDivers: 1,
      ready: 1,
      blocked: 0,
      boarded: 0,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 1,
      unaccountedFor: 1,
      overCapacity: 0,
      notHere: 0,
    },
  } as TripManifest;
}

const save = (diver: Partial<TripManifest["divers"][number]>) =>
  serializeManifests([manifestWith(diver)], shop, (blocker) => blocker.code).manifests[0]
    ?.divers[0] as Record<string, unknown>;

describe("the dock copy of a training dive", () => {
  it("carries the course it counts toward and whether an instructor is aboard", () => {
    expect(
      save({ trainingDive: { courseTitle: "Advanced Open Water", instructorAboard: false } })
        .trainingDive,
    ).toEqual({ courseTitle: "Advanced Open Water", instructorAboard: false });
  });

  it("keeps the recorded intro classification for the offline depth prompt", () => {
    for (const intro of [true, false]) {
      expect(
        save({ trainingDive: { courseTitle: "Course", instructorAboard: false, intro } })
          .trainingDive,
      ).toMatchObject({ intro });
    }
  });

  it("does not save a held seat’s course or introductory classification", () => {
    const row = save({
      identityClaim: { bookedAs: "Maya", matchedBy: "picked_name" },
      readiness: { status: "blocked", blockers: [{ code: "identity_unconfirmed" }] },
      trainingDive: { courseTitle: "Intro", instructorAboard: false, intro: true },
    });
    expect(row.identityWithheld).toBe(true);
    expect(row).not.toHaveProperty("trainingDive");
  });

  it("carries who cleared a mark with its forms unsigned", () => {
    for (const cleared of [
      { byName: "Ana Ruiz", reason: "forms_owed" as const },
      { byName: null, reason: "mark_invalid" as const },
    ]) {
      expect(save({ trainingMarkCleared: cleared }).trainingMarkCleared).toEqual(cleared);
    }
  });

  it("writes neither field for an ordinary seat", () => {
    for (const diver of [{}, { trainingDive: null, trainingMarkCleared: null }]) {
      const row = save(diver);
      expect(row).not.toHaveProperty("trainingDive");
      expect(row).not.toHaveProperty("trainingMarkCleared");
    }
  });
});
