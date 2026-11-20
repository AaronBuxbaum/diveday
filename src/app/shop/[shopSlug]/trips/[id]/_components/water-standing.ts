import {
  isNotBackAboard,
  isTurnedAwayOffBoat,
  type RollCallCheckpoint,
  type RollCallRecord,
  rollCallCheckpointOrdinal,
} from "@/lib/manifests";
import type { TripStage } from "@/lib/trip-stages";

/**
 * **Where the boat stands, from what the crew recorded** (ADR
 * 20261117-trip-page-clock, On the water). Read off the roll call's own
 * manifests, one per count (the dock, then after each planned dive), and the
 * crew's latest stage word. Never from the clock: a person is "not back" only
 * where a count says so, and "not yet recorded" only where the latest count
 * has no result for them. There is no home count; the trip's return is the
 * crew's Home or the schedule.
 *
 * Codes and data only; `water-copy.ts` says it.
 */

type Seat = {
  bookingId: string;
  fullName: string;
  personId?: string;
  identityWithheld?: boolean;
  turnedAway?: boolean | null;
  notHere?: boolean;
  rollCall?: RollCallRecord;
  readiness?: { status: string };
  buddyTeam?: { others: readonly { fullName: string }[] } | null;
};

type CrewMember = {
  id: string;
  fullName: string;
  rollCall?: RollCallRecord;
  buddyTeams?: readonly { others: readonly { fullName: string }[] }[];
};

/** One roll-call count: the roll call's manifest at that checkpoint. */
export type WaterCount = {
  checkpoint: RollCallCheckpoint;
  divers: readonly Seat[];
  crew: readonly CrewMember[];
  completeness: { complete: boolean };
};

export type WaterPersonStatus = "missingAlert" | "notBack" | "conflict" | "unrecorded";

/** One person the latest count has not recorded back aboard. */
export type WaterPerson = {
  key: string;
  name: string;
  /** Crew only: a guest who also crews reads as the guest. */
  crew: boolean;
  status: WaterPersonStatus;
  /** The dive whose count recorded them not back aboard, for `notBack`. */
  afterDive: number | null;
  buddies: string[];
  /** The crew's own sentence about them, when one was written. */
  note: string | null;
};

/** A count's result: who it recorded aboard of who was expected, and its last entry. */
export type CountResult = {
  dive: number;
  complete: boolean;
  aboard: number;
  out: number;
  /** Of `aboard`, the crew the count recorded aboard. */
  crewAboard: number;
  by: string | null;
  at: Date | null;
};

export type StopState = "done" | "now" | "ahead";

export type WaterStop =
  | { kind: "dock"; state: StopState; count: CountResult | null; checks: BoatChecks | null }
  | { kind: "stage"; state: "done"; stage: TripStage; at: Date }
  | {
      kind: "dive";
      state: StopState;
      dive: number;
      site: string | null;
      count: CountResult | null;
      logged: LoggedDive | null;
      /**
       * The crew's standing record that this planned dive was not made (issue
       * #4681), who and when; null once any count speaks for the dive, since a
       * dive somebody counted was made. Optional for a stop drawn by hand.
       */
      notMade?: DiveNotMade | null;
    }
  | { kind: "home"; state: StopState; saidAt: Date | null; scheduled: Date };

export type LoggedDive = {
  enteredAt: Date | null;
  exitedAt: Date | null;
  maxDepthMeters: number | null;
};

export type BoatChecks = { checked: number; total: number };

/** Who recorded a planned dive as not made, and when (`dive_not_made_events`). */
export type DiveNotMade = { by: string; at: Date };

export type WaterStandingInput = {
  counts: readonly WaterCount[];
  /** Booking and person ids the owners were alerted about and are not found yet. */
  alerted: ReadonlySet<string>;
  /**
   * Open missing-diver alerts on the departure, named or not: one that names
   * nobody still leads the sentence.
   */
  openAlerts?: number;
  plannedDives: readonly { diveNumber: number; site: string | null }[];
  logged: ReadonlyMap<number, LoggedDive>;
  stage: { stage: TripStage; recordedAt: Date } | null;
  /** The crew said Home on the last day (`finalHomeSaid`). */
  homeSaidAt: Date | null;
  endsAt: Date;
  boatChecks: BoatChecks | null;
  /** Planned dives the crew recorded not made, by dive number (`diveNotMadeStanding`). */
  notMade?: ReadonlyMap<number, DiveNotMade>;
};

export type WaterStanding = {
  /** The latest count with anything recorded on it, or null for none. */
  latest: CountResult | null;
  /** Open missing-diver alerts, said first whatever the counts say. */
  alerts: number;
  /** Not yet recorded back at the latest after-dive count, worst first. */
  notYetBack: WaterPerson[];
  /** Who the latest started count (dock or after a dive) recorded aboard, by name. */
  lastAboard: string[];
  timeline: WaterStop[];
  /**
   * Seats the dock count never placed (no record, not released by the desk):
   * `blocked` when readiness blocks them, `noRecord` otherwise. Named plainly
   * once the boat has left; never a button.
   */
  unplaced: { noRecord: string[]; blocked: string[] };
};

const STATUS_RANK: Record<WaterPersonStatus, number> = {
  missingAlert: 0,
  notBack: 1,
  conflict: 2,
  unrecorded: 3,
};

export function waterStanding(input: WaterStandingInput): WaterStanding {
  const counts = [...input.counts].sort(
    (a, b) => rollCallCheckpointOrdinal(a.checkpoint) - rollCallCheckpointOrdinal(b.checkpoint),
  );
  const results = new Map(counts.map((count) => [count.checkpoint, countResult(count, counts)]));
  const started = counts.filter((count) => results.get(count.checkpoint)?.by !== null);
  const latestCount = started.at(-1) ?? null;
  const latest = latestCount ? (results.get(latestCount.checkpoint) ?? null) : null;
  const notYetBack =
    latestCount && latestCount.checkpoint !== "departure"
      ? outstandingPeople(latestCount, counts, input.alerted)
      : alertedOnly(counts, input.alerted);
  return {
    latest,
    alerts: Math.max(
      notYetBack.filter((person) => person.status === "missingAlert").length,
      input.openAlerts ?? 0,
    ),
    notYetBack,
    lastAboard: latestCount ? aboardAt(latestCount, counts) : [],
    timeline: timeline(input, counts, results),
    unplaced: unplacedAtDock(counts),
  };
}

function unplacedAtDock(counts: readonly WaterCount[]): WaterStanding["unplaced"] {
  const dock = counts.find((count) => count.checkpoint === "departure");
  const out: WaterStanding["unplaced"] = { noRecord: [], blocked: [] };
  for (const seat of dock?.divers ?? []) {
    if (seat.rollCall || seat.notHere || seat.turnedAway) continue;
    (seat.readiness?.status === "blocked" ? out.blocked : out.noRecord).push(seat.fullName);
  }
  return out;
}

/** Everyone one count recorded aboard, once each, guests first. */
function aboardAt(count: WaterCount, counts: readonly WaterCount[]): string[] {
  const names = new Map<string, string>();
  for (const seat of count.divers) {
    if (isTurnedAwayOffBoat(seat) || expectedNowhere(seat, counts)) continue;
    if (roleAt(count.checkpoint, seat.rollCall) === "aboard")
      names.set(seatKey(seat), seat.fullName);
  }
  for (const member of count.crew) {
    const key = `p:${member.id}`;
    if (!names.has(key) && roleAt(count.checkpoint, member.rollCall) === "aboard") {
      names.set(key, member.fullName);
    }
  }
  return [...names.values()];
}

/** Who a count recorded aboard of who was expected there, and its last entry. */
function countResult(count: WaterCount, counts: readonly WaterCount[]): CountResult {
  const dive = rollCallCheckpointOrdinal(count.checkpoint);
  const people = new Map<string, "aboard" | "out" | "ashore">();
  const mark = (key: string, value: "aboard" | "out" | "ashore") => {
    const before = people.get(key);
    // One body, two roles: aboard only when both roles are.
    if (before === undefined || before === "aboard" || value === "out") people.set(key, value);
  };
  for (const seat of count.divers) {
    if (isTurnedAwayOffBoat(seat)) continue;
    if (expectedNowhere(seat, counts)) continue;
    mark(seatKey(seat), roleAt(count.checkpoint, seat.rollCall));
  }
  for (const member of count.crew)
    mark(`p:${member.id}`, roleAt(count.checkpoint, member.rollCall));
  const values = [...people.values()];
  const recorded = [...count.divers, ...count.crew]
    .map((row) => row.rollCall)
    .filter((rollCall): rollCall is RollCallRecord => !!rollCall && rollCall.implied !== true)
    .sort((a, b) => b.occurredAt.getTime() - a.occurredAt.getTime());
  return {
    dive,
    complete: count.completeness.complete,
    aboard: values.filter((value) => value === "aboard").length,
    out: values.filter((value) => value !== "ashore").length,
    crewAboard: count.crew.filter(
      (member) => roleAt(count.checkpoint, member.rollCall) === "aboard",
    ).length,
    by: recorded[0]?.recordedByName ?? null,
    at: recorded[0]?.occurredAt ?? null,
  };
}

/**
 * A seat the desk released with no word from the boat at any count is not a
 * body to expect (#1209): out of the fraction and the list, as the roll
 * call's own count panel has it.
 */
function expectedNowhere(seat: Seat, counts: readonly WaterCount[]): boolean {
  if (!seat.notHere) return false;
  return counts.every(
    (count) => !count.divers.find((other) => other.bookingId === seat.bookingId)?.rollCall,
  );
}

function roleAt(
  checkpoint: RollCallCheckpoint,
  rollCall: RollCallRecord | undefined,
): "aboard" | "out" | "ashore" {
  if (rollCall?.state === "boarded" && !rollCall.evidenceConflict) return "aboard";
  if (rollCall?.state === "not_boarded" && !isNotBackAboard(checkpoint, rollCall)) return "ashore";
  return "out";
}

function seatKey(seat: Seat): string {
  return seat.personId && !seat.identityWithheld ? `p:${seat.personId}` : `b:${seat.bookingId}`;
}

/** Everyone the latest after-dive count has not recorded back aboard. */
function outstandingPeople(
  latest: WaterCount,
  counts: readonly WaterCount[],
  alerted: ReadonlySet<string>,
): WaterPerson[] {
  const earlier = counts.filter(
    (count) =>
      count.checkpoint !== "departure" &&
      rollCallCheckpointOrdinal(count.checkpoint) < rollCallCheckpointOrdinal(latest.checkpoint),
  );
  const byKey = new Map<string, WaterPerson>();
  const keep = (person: WaterPerson) => {
    const before = byKey.get(person.key);
    if (!before || STATUS_RANK[person.status] < STATUS_RANK[before.status]) {
      byKey.set(person.key, before ? { ...person, crew: before.crew && person.crew } : person);
    } else if (!person.crew) {
      byKey.set(person.key, { ...before, crew: false });
    }
  };
  for (const seat of latest.divers) {
    if (isTurnedAwayOffBoat(seat) || expectedNowhere(seat, counts)) continue;
    const status = personStatus(
      latest.checkpoint,
      seat.rollCall,
      earlier.map((count) => ({
        checkpoint: count.checkpoint,
        rollCall: count.divers.find((other) => other.bookingId === seat.bookingId)?.rollCall,
      })),
      alerted.has(seat.bookingId) || (!!seat.personId && alerted.has(seat.personId)),
    );
    if (!status) continue;
    keep({
      key: seatKey(seat),
      name: seat.fullName,
      crew: false,
      ...status,
      buddies: seat.buddyTeam?.others.map((other) => other.fullName) ?? [],
    });
  }
  for (const member of latest.crew) {
    const status = personStatus(
      latest.checkpoint,
      member.rollCall,
      earlier.map((count) => ({
        checkpoint: count.checkpoint,
        rollCall: count.crew.find((other) => other.id === member.id)?.rollCall,
      })),
      alerted.has(member.id),
    );
    if (!status) continue;
    keep({
      key: `p:${member.id}`,
      name: member.fullName,
      crew: true,
      ...status,
      buddies: (member.buddyTeams ?? []).flatMap((team) =>
        team.others.map((other) => other.fullName),
      ),
    });
  }
  return [...byKey.values()].sort((a, b) => STATUS_RANK[a.status] - STATUS_RANK[b.status]);
}

/**
 * One person's standing at the latest count, or null when it recorded them
 * aboard or they never left the dock. A missing-diver alert outranks every
 * count; a "did not come back" stands until a later count says otherwise.
 */
function personStatus(
  checkpoint: RollCallCheckpoint,
  rollCall: RollCallRecord | undefined,
  earlier: readonly { checkpoint: RollCallCheckpoint; rollCall: RollCallRecord | undefined }[],
  alerted: boolean,
): Pick<WaterPerson, "status" | "afterDive" | "note"> | null {
  const note = rollCall?.note ?? null;
  if (alerted) {
    return { status: "missingAlert", afterDive: notBackDive(checkpoint, rollCall, earlier), note };
  }
  if (rollCall?.evidenceConflict) return { status: "conflict", afterDive: null, note };
  if (isNotBackAboard(checkpoint, rollCall)) {
    return { status: "notBack", afterDive: rollCallCheckpointOrdinal(checkpoint), note };
  }
  if (rollCall) return null;
  const said = [...earlier].reverse().find((count) => count.rollCall && !count.rollCall.implied);
  if (said && isNotBackAboard(said.checkpoint, said.rollCall)) {
    return {
      status: "notBack",
      afterDive: rollCallCheckpointOrdinal(said.checkpoint),
      note: said.rollCall?.note ?? null,
    };
  }
  return { status: "unrecorded", afterDive: null, note: null };
}

function notBackDive(
  checkpoint: RollCallCheckpoint,
  rollCall: RollCallRecord | undefined,
  earlier: readonly { checkpoint: RollCallCheckpoint; rollCall: RollCallRecord | undefined }[],
): number | null {
  if (isNotBackAboard(checkpoint, rollCall)) return rollCallCheckpointOrdinal(checkpoint);
  const said = [...earlier]
    .reverse()
    .find((count) => isNotBackAboard(count.checkpoint, count.rollCall));
  return said ? rollCallCheckpointOrdinal(said.checkpoint) : null;
}

/** Before any after-dive count, only an open alert names anybody. */
function alertedOnly(counts: readonly WaterCount[], alerted: ReadonlySet<string>): WaterPerson[] {
  const dock = counts[0];
  if (!dock || alerted.size === 0) return [];
  const people: WaterPerson[] = [];
  for (const seat of dock.divers) {
    if (alerted.has(seat.bookingId) || (seat.personId && alerted.has(seat.personId))) {
      people.push({
        key: seatKey(seat),
        name: seat.fullName,
        crew: false,
        status: "missingAlert",
        afterDive: null,
        buddies: [],
        note: null,
      });
    }
  }
  for (const member of dock.crew) {
    if (alerted.has(member.id) && !people.some((person) => person.key === `p:${member.id}`)) {
      people.push({
        key: `p:${member.id}`,
        name: member.fullName,
        crew: true,
        status: "missingAlert",
        afterDive: null,
        buddies: [],
        note: null,
      });
    }
  }
  return people;
}

/** The day so far: what was recorded, then what the plan still holds. */
function timeline(
  input: WaterStandingInput,
  counts: readonly WaterCount[],
  results: ReadonlyMap<RollCallCheckpoint, CountResult>,
): WaterStop[] {
  const stateOf = (result: CountResult | undefined): StopState =>
    !result || result.by === null ? "ahead" : result.complete ? "done" : "now";
  const dock = results.get("departure");
  const stops: WaterStop[] = [
    {
      kind: "dock",
      state: stateOf(dock),
      count: dock && dock.by !== null ? dock : null,
      checks: input.boatChecks && input.boatChecks.total > 0 ? input.boatChecks : null,
    },
  ];
  if (input.stage && input.stage.stage !== "home" && input.stage.stage !== "boarding") {
    stops.push({ kind: "stage", state: "done", ...input.stage, at: input.stage.recordedAt });
  }
  const dives = new Set([
    ...input.plannedDives.map((dive) => dive.diveNumber),
    ...counts.map((count) => rollCallCheckpointOrdinal(count.checkpoint)).filter((n) => n > 0),
  ]);
  for (const dive of [...dives].sort((a, b) => a - b)) {
    const result = results.get(`after_dive_${dive}`);
    const count = result && result.by !== null ? result : null;
    stops.push({
      kind: "dive",
      state: stateOf(result),
      dive,
      site: input.plannedDives.find((planned) => planned.diveNumber === dive)?.site ?? null,
      count,
      logged: input.logged.get(dive) ?? null,
      // A count or a log outranks the record: whoever began counting the dive,
      // or logged its times or depth, saw it made.
      notMade:
        count || wasLogged(input.logged.get(dive)) ? null : (input.notMade?.get(dive) ?? null),
    });
  }
  stops.push({
    kind: "home",
    state: input.homeSaidAt ? "done" : "ahead",
    saidAt: input.homeSaidAt,
    scheduled: input.endsAt,
  });
  return stops;
}

/** A log with an entry or exit time, or a depth, says the dive was made. */
export function wasLogged(log: LoggedDive | undefined): boolean {
  return Boolean(log && (log.enteredAt || log.exitedAt || log.maxDepthMeters != null));
}
