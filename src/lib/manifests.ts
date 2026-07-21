import type { RentalFitLine } from "./dive-prep";
import type { ReadinessResult } from "./readiness";
import { unavailableReadiness } from "./readiness";
import type { MedicalWaiverMark } from "./waivers";

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

export type ManifestDiverInput = {
  bookingId: string;
  fullName: string;
  email: string | null;
  emergencyContactName: string | null;
  emergencyContactPhone: string | null;
  readiness?: ReadinessResult;
  /** Rental kit line, including whether a fit was ever recorded at all. */
  rentalFit: RentalFitLine;
  /**
   * The diver *asked* for enriched air and holds a verified card. It is not a
   * record of what is in a cylinder: DiveDay logs no gas analysis, so the crew
   * still analyzes and signs for the actual mix before anyone breathes it.
   */
  nitroxRequested: boolean;
  /**
   * When and how the diver's medical currency was last established, for spotting
   * a statement going stale. Null unless the governing waiver is a clean
   * completion — digital (questionnaire) or a staff-attested paper review. Not
   * carried into the offline snapshot (dock roll call doesn't need it).
   */
  medicalWaiver?: MedicalWaiverMark | null;
  rollCall?: RollCallRecord;
};

export type RollCallRecord = {
  state: Exclude<RollCallState, "awaiting">;
  occurredAt: Date;
  recordedByName: string;
  note: string | null;
  /**
   * True when this result was not recorded at this checkpoint but carried
   * forward: a diver left the boat at an earlier checkpoint, so every later
   * checkpoint defaults to not boarded until staff say otherwise.
   */
  implied?: boolean;
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
    /** Divers deliberately left ashore, including carried-forward defaults. */
    notBoarded: number;
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
      notBoarded: divers.filter((diver) => diver.rollCall?.state === "not_boarded").length,
      awaiting: divers.filter((diver) => !diver.rollCall).length,
    },
  };
}

export function rollCallLabel(rollCall: ManifestDiverInput["rollCall"]): string {
  if (!rollCall) return "Awaiting roll call";
  if (rollCall.state === "boarded") return "Boarded";
  return rollCall.implied ? "Not boarded · carried" : "Not boarded";
}

/**
 * Fills the "off the boat stays off the boat" default across one diver's
 * ordered checkpoints. Once a diver is explicitly not boarded, every later
 * checkpoint with no result of its own defaults to not boarded (flagged
 * `implied`) until an explicit boarded result breaks the chain. Carry-forward
 * never fabricates a "boarded": the default can only ever read absent.
 *
 * A `cleared` undo has already been collapsed to "no result" upstream
 * (listLatestRollCallByBooking), so it is not seen here as a breaker. Clearing
 * the *originating* not-boarded removes the source and the whole chain reverts
 * to awaiting; clearing a later re-board reverts that checkpoint to the carried
 * default. Pure and order-sensitive: pass the checkpoints in departure→last
 * order.
 */
export function carryForwardNotBoarded(
  perCheckpoint: readonly (RollCallRecord | undefined)[],
): (RollCallRecord | undefined)[] {
  let carried: RollCallRecord | undefined;
  return perCheckpoint.map((result) => {
    if (result) {
      carried = result.state === "not_boarded" ? result : undefined;
      return result;
    }
    return carried ? { ...carried, implied: true } : undefined;
  });
}
