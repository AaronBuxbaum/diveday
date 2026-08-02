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
  /**
   * The crew member's `people.id`. Carried even though nothing addresses a crew
   * member individually yet: dropping it is what foreclosed a per-person crew
   * roll call, since no id ever reached a surface that could have named one
   * (ADR 20260802-crew-roll-call-attestation). It is also the stable list key —
   * two crew can share a full name.
   */
  id: string;
  fullName: string;
  roles: string[];
};

/**
 * A staff member's statement of how many crew are aboard at one checkpoint,
 * out of how many the trip has assigned. The crew half of the head count:
 * crew hold no booking, so they are not roll-call subjects, and before this
 * existed a checkpoint could read "complete" with a divemaster still down.
 *
 * Interim by design — a count, not a per-person roll call. See the ADR.
 */
export type CrewAttestation = {
  /** Bodies counted by a human. Never derived from the assignment list. */
  crewAboard: number;
  /** What the assignment count was when it was attested (evidence, not the gate). */
  crewAssigned: number;
  attestedByName: string;
  occurredAt: Date;
  note: string | null;
};

/**
 * Why a checkpoint is not closed yet. Codes, not sentences — the UI picks the
 * words (`src/i18n/locales/*/staff.json`).
 *
 * - `no_divers` — nothing to count; an empty roster never reads complete.
 * - `divers_awaiting` — at least one booked diver has no result here.
 * - `crew_not_attested` — every diver is counted, but nobody has said how many
 *   crew are aboard. Includes a trip with *zero* assigned crew: "0 of 0" is
 *   still a human statement, never an automatic pass (see below).
 * - `crew_short` — fewer crew were counted aboard than the trip has assigned.
 */
export type RollCallIncompleteReason =
  | "no_divers"
  | "divers_awaiting"
  | "crew_not_attested"
  | "crew_short";

export type RollCallCompleteness = {
  complete: boolean;
  diversAccountedFor: boolean;
  crewAccountedFor: boolean;
  reason: RollCallIncompleteReason | null;
};

/**
 * The single definition of "this checkpoint is closed", shared by the live
 * manifest and the offline copy. It used to be written twice, inline, at the UI
 * layer (`manifest/page.tsx` and `OfflineManifestView.tsx`), as
 * `totalDivers > 0 && awaiting === 0` — divers only. Crew are the people most
 * reliably in the water and were not part of it, so a boat could read "roll call
 * complete" with a divemaster still down.
 *
 * Rules, in order:
 *
 * 1. Divers first, unchanged: an empty roster is never complete, and every
 *    booked diver needs a result at this checkpoint.
 * 2. Then crew: an attestation must exist, and it must account for at least as
 *    many crew as the trip has assigned **right now** — not the denominator
 *    stored on the attestation. Assigning another crew member after the fact
 *    re-opens the checkpoint instead of riding on a stale count.
 *
 * **Zero assigned crew does not auto-complete.** A trip with no crew assigned is
 * a scheduling gap (the app already nags about it as a coverage gap), not
 * evidence that nobody else was aboard, so "0 of 0" still has to be said out
 * loud by a named human. The alternative — treating an empty assignment list as
 * satisfied — would hand back exactly the silent pass this whole check exists to
 * remove, and would do it on precisely the trips whose crew data is worst.
 *
 * Counting *more* crew aboard than are assigned is fine and reads complete: an
 * extra deckhand is a person accounted for, not a person missing. The stored
 * denominator keeps the discrepancy visible.
 */
export function rollCallCompleteness(input: {
  totalDivers: number;
  awaiting: number;
  /** Assigned crew *now* — `manifest.crew.length`, not the attested denominator. */
  crewAssigned: number;
  crewAttestation?: CrewAttestation | null;
}): RollCallCompleteness {
  const diversAccountedFor = input.totalDivers > 0 && input.awaiting === 0;
  const attestation = input.crewAttestation ?? null;
  const crewAccountedFor = attestation !== null && attestation.crewAboard >= input.crewAssigned;
  const reason: RollCallIncompleteReason | null =
    input.totalDivers === 0
      ? "no_divers"
      : input.awaiting > 0
        ? "divers_awaiting"
        : attestation === null
          ? "crew_not_attested"
          : crewAccountedFor
            ? null
            : "crew_short";
  return {
    complete: diversAccountedFor && crewAccountedFor,
    diversAccountedFor,
    crewAccountedFor,
    reason,
  };
}

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
  /** The latest crew count attested at this checkpoint, if any. */
  crewAttestation: CrewAttestation | null;
  /**
   * Whether this checkpoint is closed — divers *and* crew. Derived here so the
   * live page and the offline copy cannot drift apart; the offline view
   * recomputes it with `rollCallCompleteness` because its `awaiting` count comes
   * from events on the device, not from this snapshot.
   */
  completeness: RollCallCompleteness;
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
  crewAttestation?: CrewAttestation | null;
  divers: ManifestDiverInput[];
}): TripManifest {
  const divers = input.divers.map((diver) => ({
    ...diver,
    readiness: diver.readiness ?? unavailableReadiness(),
    rollCall: diver.rollCall,
  }));
  const summary = {
    totalDivers: divers.length,
    ready: divers.filter((diver) => diver.readiness.status === "ready").length,
    blocked: divers.filter((diver) => diver.readiness.status === "blocked").length,
    boarded: divers.filter((diver) => diver.rollCall?.state === "boarded").length,
    notBoarded: divers.filter((diver) => diver.rollCall?.state === "not_boarded").length,
    awaiting: divers.filter((diver) => !diver.rollCall).length,
  };
  const crewAttestation = input.crewAttestation ?? null;
  return {
    trip: input.trip,
    checkpoint: input.checkpoint ?? "departure",
    crew: input.crew,
    crewAttestation,
    completeness: rollCallCompleteness({
      totalDivers: summary.totalDivers,
      awaiting: summary.awaiting,
      crewAssigned: input.crew.length,
      crewAttestation,
    }),
    divers,
    summary,
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
