import type { RollCallCheckpoint, TripManifest } from "@/lib/manifests";

/**
 * **One checkpoint's manifest, assembled by hand** — the fixture the page's
 * pure helpers (`open-checkpoint`, `head-count-view`, `buddy-builder-view`,
 * `offline-payload`) are called against. Divers come from the roll call's own
 * fixture (`diver-roll-call-test-fixtures.tsx`).
 */
export function crewMember(
  overrides: Partial<TripManifest["crew"][number]> = {},
): TripManifest["crew"][number] {
  return {
    id: "00000000-0000-4000-8000-0000000000c1",
    fullName: "Keiko Tanaka",
    roles: ["divemaster"],
    standingRatings: [],
    emergencyContactName: "Haru Tanaka",
    emergencyContactPhone: "+81-3-555-0103",
    buddyTeams: [],
    buddyAlert: null,
    ...overrides,
  } as TripManifest["crew"][number];
}

export function tripManifest(overrides: Partial<TripManifest> = {}): TripManifest {
  const checkpoint: RollCallCheckpoint = overrides.checkpoint ?? "departure";
  return {
    trip: {
      id: "00000000-0000-4000-8000-0000000000ff",
      title: "Molasses Reef two-tank",
      startsAt: new Date("2026-09-11T12:00:00.000Z"),
      endsAt: new Date("2026-09-11T16:00:00.000Z"),
      plannedDives: 2,
    },
    checkpoint,
    crew: [],
    divers: [],
    completeness: {
      complete: false,
      diversAccountedFor: false,
      crewAccountedFor: true,
      reason: "divers_awaiting",
      crewReason: null,
      crewCounts: { crewAssigned: 0, crewAwaiting: 0, crewNotBackAboard: 0, crewAshore: 0 },
    },
    summary: {
      totalDivers: 0,
      ready: 0,
      blocked: 0,
      boarded: 0,
      notBoarded: 0,
      notBackAboard: 0,
      awaiting: 0,
      notHere: 0,
    },
    ...overrides,
  } as TripManifest;
}
