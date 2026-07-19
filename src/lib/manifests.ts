import type { ReadinessResult } from "./readiness";
import { unavailableReadiness } from "./readiness";

export type RollCallState = "awaiting" | "boarded" | "not_boarded";

export type RollCallCheckpoint = "departure" | `after_dive_${number}`;

export function rollCallCheckpoints(plannedDives: number): RollCallCheckpoint[] {
  const safeCount = Math.max(1, Math.min(4, Math.trunc(plannedDives)));
  return [
    "departure",
    ...Array.from({ length: safeCount }, (_, index) => `after_dive_${index + 1}` as const),
  ];
}

export function isRollCallCheckpoint(
  value: string,
  plannedDives: number,
): value is RollCallCheckpoint {
  return rollCallCheckpoints(plannedDives).some((checkpoint) => checkpoint === value);
}

export function rollCallCheckpointLabel(checkpoint: RollCallCheckpoint): string {
  if (checkpoint === "departure") return "Before departure";
  return `After dive ${checkpoint.slice("after_dive_".length)}`;
}

export type ManifestGear = {
  label: string;
  type: string;
};

export type ManifestDiverInput = {
  bookingId: string;
  fullName: string;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  readiness?: ReadinessResult;
  gear: ManifestGear[];
  rollCall?: {
    state: Exclude<RollCallState, "awaiting">;
    occurredAt: Date;
    recordedByName: string;
    note: string | null;
  };
};

export type ManifestCrewMember = {
  fullName: string;
  roles: string[];
};

export type TripManifest = {
  trip: {
    id: string;
    title: string;
    startsAt: Date;
    endsAt: Date;
    plannedDives: number;
  };
  checkpoint: RollCallCheckpoint;
  crew: ManifestCrewMember[];
  divers: (ManifestDiverInput & {
    readiness: ReadinessResult;
    rollCall: ManifestDiverInput["rollCall"];
  })[];
  summary: {
    totalDivers: number;
    ready: number;
    blocked: number;
    boarded: number;
    awaiting: number;
  };
};

/**
 * One pure derivation feeds the screen, print view, and future offline
 * snapshot. It preserves every supplied booking and converts missing safety
 * evidence into a blocking result rather than filtering the person away.
 */
export function buildTripManifest(input: {
  trip: TripManifest["trip"];
  checkpoint?: RollCallCheckpoint;
  crew: ManifestCrewMember[];
  divers: ManifestDiverInput[];
}): TripManifest {
  const divers = input.divers.map((diver) => ({
    ...diver,
    readiness: diver.readiness ?? unavailableReadiness(),
    rollCall: diver.rollCall,
  }));
  return {
    trip: input.trip,
    checkpoint: input.checkpoint ?? "departure",
    crew: input.crew,
    divers,
    summary: {
      totalDivers: divers.length,
      ready: divers.filter((diver) => diver.readiness.status === "ready").length,
      blocked: divers.filter((diver) => diver.readiness.status === "blocked").length,
      boarded: divers.filter((diver) => diver.rollCall?.state === "boarded").length,
      awaiting: divers.filter((diver) => !diver.rollCall).length,
    },
  };
}

export function rollCallLabel(rollCall: ManifestDiverInput["rollCall"]): string {
  if (!rollCall) return "Awaiting roll call";
  return rollCall.state === "boarded" ? "Boarded" : "Not boarded";
}
