import type { ReadinessResult } from "./readiness";
import { unavailableReadiness } from "./readiness";

export type RollCallState = "awaiting" | "boarded" | "not_boarded";

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
  };
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
