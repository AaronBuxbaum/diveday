import type { TripManifest } from "@/lib/manifests";

export function baseManifest(): TripManifest {
  return {
    trip: {
      id: "trip-1",
      title: "Two-Tank Reef",
      startsAt: new Date("2026-07-20T12:00:00.000Z"),
      endsAt: new Date("2026-07-20T16:00:00.000Z"),
      plannedDives: 2,
    },
    checkpoint: "after_dive_1",
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
        fullName: "Nobody Asked",
        email: "nobody@example.com",
        emergencyContactName: null,
        emergencyContactPhone: null,
        readiness: { status: "ready", blockers: [] },
        rentalFit: { state: "own_kit" },
        nitroxRequested: false,
        checkedIn: false,
        rollCall: undefined,
        buddyAlert: null,
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
