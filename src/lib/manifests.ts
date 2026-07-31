import type { BirthdayCallout } from "./age";
import type { DepthCeilingCheck } from "./depth-ceiling";
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

/**
 * The highest dive number any *currently live* recorded roll-call checkpoint
 * for a trip refers to — 0 when history only ever touched "departure" or
 * there is no history at all. Used to stop a planned-dive-count edit from
 * silently orphaning operational history that already happened (CR-006): a
 * trip cannot be edited down to fewer dives than staff have already recorded
 * a roll call against.
 *
 * A `cleared` event is an explicit undo — "the diver returns to awaiting"
 * (`RollCallState`, this file). Roll-call events are append-only (a clear
 * inserts a new row, it never replaces the boarded/not_boarded row it
 * undoes — `recordRollCall`, src/db/manifests.ts), so "does history include
 * a cleared event" is the wrong question; the right one, mirroring
 * `listLatestRollCallByBooking`'s own "clear undoes to awaiting" semantics,
 * is "for this diver at this checkpoint, does their *latest* event still
 * stand." Without reducing to latest-per-booking-per-checkpoint first, a
 * crew member's mis-tap-then-clear (wet hands, glare — the exact failure
 * mode this app's manifest is built to tolerate) would permanently block a
 * legitimate later correction, e.g. shrinking a weather-cancelled trip's
 * dive count, even though no diver's *current* roll-call state was ever
 * actually recorded there (dive-domain-expert review finding).
 */
export function maxRecordedDiveNumber(
  events: readonly {
    bookingId: string;
    checkpoint: string;
    status: string;
    occurredAt: Date;
    createdAt: Date;
  }[],
): number {
  const latestByKey = new Map<string, (typeof events)[number]>();
  for (const event of events) {
    const key = `${event.bookingId}\u0000${event.checkpoint}`;
    const current = latestByKey.get(key);
    if (
      !current ||
      event.occurredAt > current.occurredAt ||
      (event.occurredAt.getTime() === current.occurredAt.getTime() &&
        event.createdAt > current.createdAt)
    ) {
      latestByKey.set(key, event);
    }
  }

  let max = 0;
  for (const event of latestByKey.values()) {
    if (event.status === "cleared") continue;
    const match = /^after_dive_(\d+)$/.exec(event.checkpoint);
    if (!match) continue;
    const diveNumber = Number(match[1]);
    if (diveNumber > max) max = diveNumber;
  }
  return max;
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
   * Whole years on the trip date, and whether that makes them a minor (H-21).
   * Both null/false when the shop holds no date of birth — the captain reading
   * the boarding list sees nothing rather than an "unknown age" on most of the
   * boat. Not a gate: nothing here blocks boarding, it is a fact the crew is
   * entitled to know before the lines come off.
   */
  age?: number | null;
  minor?: boolean;
  /** The diver has a birthday today or within the callout window (H-21). */
  birthday?: BirthdayCallout | null;
  /**
   * Whether the trip's deepest site goes past this diver's ceiling (H-08).
   * Carried here and not only on the roster because the plan for dive two is
   * made on the boat during the surface interval, from this list — which is
   * exactly when a depth advisory is actionable. Never a gate.
   */
  depthAdvisory?: DepthCeilingCheck;
  /**
   * When and how the diver's medical currency was last established, for spotting
   * a statement going stale. Null unless the governing waiver is a clean
   * completion — digital (questionnaire), a staff-attested paper review, or a
   * contact-imported acceptance DiveDay never itself reviewed (`source:
   * "imported"`, ADR 20260724-import-waiver-acceptance — crew-facing surfaces
   * must render this distinctly from a real review, never folded into the same
   * label). Not carried into the offline snapshot (dock roll call doesn't need
   * it).
   */
  medicalWaiver?: MedicalWaiverMark | null;
  rollCall?: RollCallRecord;
  /**
   * The diver was confirmed at the counter (`bookings.status === "checked_in"`).
   * Counter check-in and boat roll call are two different questions — arrived
   * vs. aboard — and `checked_in` used to have exactly one reader in the app
   * (the check-in page itself). Carrying it onto the manifest lets crew see
   * who already showed up even before boarding them (task 149, UX persona
   * lens 17).
   */
  checkedIn: boolean;
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
