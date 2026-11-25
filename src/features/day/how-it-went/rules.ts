import type {
  IncidentCrewEntry,
  IncidentExecutedDive,
  IncidentRosterEntry,
  IncidentTimelineEntry,
  IncidentTurnedAwayEntry,
} from "@/lib/incident-export";
import type { ReadinessBlocker } from "@/lib/readiness";
import type { RollCallCheckpoint } from "@/lib/roll-call";
import type { CountedAboardBlocked } from "@/lib/roll-call-readiness";
import type { TurnAwayReason } from "@/lib/turn-away";

/**
 * **How it went** (glossary): the owner's short account of one departure,
 * read after the boat is back. Three parts, each from a record and never from
 * the clock or a guess:
 *
 * - **Head counts**: one row per checkpoint, the dock then after each planned
 *   dive: the divers and the crew recorded aboard (never summed: one person
 *   may hold a seat and crew), who was not back, who the counts disagree on,
 *   and who has no result. After a dive, "no result" names everyone recorded
 *   aboard at an earlier count, even when nobody started this one: a count
 *   nobody took is never read as everyone back (glossary, "Unaccounted for").
 *   A diver recorded not back and later back aboard keeps both marks.
 * - **Sorted before boarding**: for a diver the dock count recorded aboard,
 *   each waiver signed, card checked (as captured at boarding when it was)
 *   and rental fit stated during the departure and no later than that dock
 *   mark. Without a dock count it is not known, and says so. Then who the
 *   desk turned away and why, and who was counted aboard while readiness
 *   said blocked (the snapshot the boarding event kept, never recomputed).
 * - **Waivers**: signed ahead, signed during the departure (a paper release
 *   says so), signed after it, waiting on a doctor, not cleared by one, and
 *   not signed. Held seats are left out, because the record would be the
 *   matched person's.
 *
 * Codes and data only; the page and the email say it.
 */

export type HowItWentFixKind = "waiver" | "card" | "rentalFit";

export type HowItWentFix = { kind: HowItWentFixKind; at: string };

export type HowItWentCount = {
  checkpoint: RollCallCheckpoint;
  /** 0 for the dock count. */
  dive: number;
  /** The site the crew logged for that dive, else null. */
  site: string | null;
  /** False when nobody has a settled mark at this checkpoint. */
  taken: boolean;
  /** Seats recorded aboard, settled. */
  divers: number;
  /** Crew recorded aboard, settled. */
  crew: number;
  /** Recorded not back aboard after a dive. */
  notBack: string[];
  /** Two marks disagree, or a mark waits on the crew's review: not counted either way. */
  unsettled: string[];
  /** No result here, though expected: everyone after a taken dock count, or aboard at an earlier count. */
  notRecorded: string[];
  /** Left ashore at the dock count. */
  ashore: string[];
  /** Recorded not back aboard at this checkpoint, then back aboard. */
  recovered: { name: string; notBackAt: string; backAt: string }[];
  /** The latest mark at this checkpoint and who made it. */
  at: string | null;
  by: string | null;
};

export type HowItWent = {
  counts: HowItWentCount[];
  /** Null when no dock count was taken: what was sorted before boarding is not known. */
  sorted: { name: string; fixes: HowItWentFix[] }[] | null;
  turnedAway: { name: string; reason: TurnAwayReason | null; thenBoarded?: true }[];
  boardedBlocked: { name: string; dive: number; blockers: ReadinessBlocker[] }[];
  waivers: {
    ahead: number;
    during: { name: string; at: string; paper: boolean }[];
    after: { name: string; at: string }[];
    doctorPending: string[];
    doctorDeclined: string[];
    notSigned: string[];
    /** Seats held for an identity review: their waiver is not shown. */
    held: number;
  };
};

export type HowItWentInput = {
  checkpoints: readonly RollCallCheckpoint[];
  roster: readonly IncidentRosterEntry[];
  crew: readonly IncidentCrewEntry[];
  turnedAway: readonly (IncidentTurnedAwayEntry & { thenBoarded?: true })[];
  executedDives: readonly Pick<IncidentExecutedDive, "diveNumber" | "actualSiteName">[];
  timeline: readonly IncidentTimelineEntry[];
  /** Seats the dock or a later count recorded aboard while readiness said blocked. */
  countedAboardBlocked: ReadonlyMap<string, CountedAboardBlocked>;
  /**
   * Marks the live manifest does not settle, per checkpoint: a seat's booking
   * id or a crew member's name whose marks disagree or wait on review.
   */
  unsettled: ReadonlyMap<string, ReadonlySet<string>>;
  /** When each seat's rental fit was last stated, by booking; absent or null when none. */
  fitStatedAt: ReadonlyMap<string, Date | null>;
  /** The departure's dates in the shop's zone: its first day's start to its last day's end. */
  span: { from: Date; to: Date };
};

/** A release a staffer recorded watching signed on paper (`src/lib/signatures.ts`). */
const isPaper = (method: string | null) => method?.startsWith("in_person_attested") ?? false;

const ms = (at: string | Date) => new Date(at).getTime();

function diveOf(checkpoint: string): number {
  if (checkpoint === "departure") return 0;
  return Number(checkpoint.slice("after_dive_".length));
}

type Person = {
  key: string;
  name: string;
  crew: boolean;
  results: IncidentRosterEntry["rollCall"];
};

function countAt(
  input: HowItWentInput,
  people: readonly Person[],
  checkpoint: RollCallCheckpoint,
  index: number,
): HowItWentCount {
  const dive = diveOf(checkpoint);
  const unsettledHere = input.unsettled.get(checkpoint) ?? new Set<string>();
  let divers = 0;
  let crew = 0;
  const notBack: string[] = [];
  const unsettled: string[] = [];
  const awaiting: Person[] = [];
  const ashore: string[] = [];
  let latest: { at: string; by: string | null } | null = null;
  for (const person of people) {
    const result = person.results.find((entry) => entry.checkpoint === checkpoint);
    const label = result?.label ?? "awaiting";
    if (unsettledHere.has(person.key)) {
      unsettled.push(person.name);
      continue;
    }
    if (label === "awaiting") {
      awaiting.push(person);
      continue;
    }
    if (result?.occurredAt && (!latest || result.occurredAt > latest.at)) {
      latest = { at: result.occurredAt, by: result.recordedByName };
    }
    if (label === "boarded") {
      if (person.crew) crew += 1;
      else divers += 1;
    } else if (label === "not_back_aboard") {
      notBack.push(person.name);
    } else if (label === "not_boarded" && dive === 0) {
      ashore.push(person.name);
    }
  }
  const taken = latest !== null;
  // Who this count owes a result: at the dock, everyone once the count began;
  // after a dive, everyone an earlier count recorded aboard, begun or not.
  const notRecorded = awaiting
    .filter((person) =>
      dive === 0
        ? taken
        : taken ||
          person.results
            .slice(0, index)
            .some((entry) => entry.label === "boarded" || entry.label === "not_back_aboard"),
    )
    .map((person) => person.name);
  const recovered: HowItWentCount["recovered"] = [];
  if (dive > 0) {
    const marks = input.timeline.filter(
      (entry): entry is Extract<IncidentTimelineEntry, { kind: "diver" | "crew" }> =>
        (entry.kind === "diver" || entry.kind === "crew") && entry.checkpoint === checkpoint,
    );
    for (const [position, mark] of marks.entries()) {
      if (mark.action !== "not_boarded") continue;
      const back = marks
        .slice(position + 1)
        .find((later) => later.subjectName === mark.subjectName && later.action === "boarded");
      if (back) {
        recovered.push({
          name: mark.subjectName,
          notBackAt: mark.occurredAt,
          backAt: back.occurredAt,
        });
      }
    }
  }
  return {
    checkpoint,
    dive,
    site:
      dive === 0
        ? null
        : (input.executedDives.find((row) => row.diveNumber === dive)?.actualSiteName ?? null),
    taken,
    divers,
    crew,
    notBack,
    unsettled,
    notRecorded,
    ashore,
    recovered,
    at: latest?.at ?? null,
    by: latest?.by ?? null,
  };
}

function sortedBeforeBoarding(input: HowItWentInput, dockTaken: boolean): HowItWent["sorted"] {
  if (!dockTaken) return null;
  const { span } = input;
  const sorted: NonNullable<HowItWent["sorted"]> = [];
  for (const diver of input.roster) {
    if (diver.identityWithheld) continue;
    if ((input.unsettled.get("departure") ?? new Set()).has(diver.bookingId)) continue;
    const dock = diver.rollCall.find((result) => result.checkpoint === "departure");
    if (dock?.label !== "boarded" || !dock.occurredAt) continue;
    const boardedAt = ms(dock.occurredAt);
    const before = (at: string | Date | null | undefined): at is string | Date =>
      !!at && ms(at) >= span.from.getTime() && ms(at) <= boardedAt;
    const fixes: HowItWentFix[] = [];
    if (diver.waiver?.state === "complete" && before(diver.waiver.signedAt)) {
      fixes.push({ kind: "waiver", at: diver.waiver.signedAt as string });
    }
    const cards = diver.certificationsAtCapture ?? diver.certifications;
    const cardAt = cards
      .filter((card) => card.status === "verified" && before(card.reviewedAt))
      .map((card) => card.reviewedAt as string)
      .sort()[0];
    if (cardAt) fixes.push({ kind: "card", at: cardAt });
    const fit = input.fitStatedAt.get(diver.bookingId);
    if (before(fit)) fixes.push({ kind: "rentalFit", at: (fit as Date).toISOString() });
    if (fixes.length > 0) {
      fixes.sort((a, b) => a.at.localeCompare(b.at));
      sorted.push({ name: diver.fullName, fixes });
    }
  }
  return sorted;
}

function waiversOf(input: HowItWentInput): HowItWent["waivers"] {
  const { span } = input;
  const waivers: HowItWent["waivers"] = {
    ahead: 0,
    during: [],
    after: [],
    doctorPending: [],
    doctorDeclined: [],
    notSigned: [],
    held: 0,
  };
  for (const diver of input.roster) {
    if (diver.identityWithheld) {
      waivers.held += 1;
      continue;
    }
    const waiver = diver.waiver;
    if (waiver?.state === "medical_review") waivers.doctorPending.push(diver.fullName);
    else if (waiver?.state === "medical_not_cleared") waivers.doctorDeclined.push(diver.fullName);
    else if (waiver?.state !== "complete" || !waiver.signedAt)
      waivers.notSigned.push(diver.fullName);
    else if (ms(waiver.signedAt) < span.from.getTime()) waivers.ahead += 1;
    else if (ms(waiver.signedAt) < span.to.getTime()) {
      waivers.during.push({
        name: diver.fullName,
        at: waiver.signedAt,
        paper: isPaper(waiver.signatureMethod),
      });
    } else waivers.after.push({ name: diver.fullName, at: waiver.signedAt });
  }
  waivers.during.sort((a, b) => a.at.localeCompare(b.at));
  waivers.after.sort((a, b) => a.at.localeCompare(b.at));
  return waivers;
}

export function howItWent(input: HowItWentInput): HowItWent {
  const people: Person[] = [
    ...input.roster.map((diver) => ({
      key: diver.bookingId,
      name: diver.fullName,
      crew: false,
      results: diver.rollCall,
    })),
    ...input.crew.map((member) => ({
      key: member.fullName,
      name: member.fullName,
      crew: true,
      results: member.rollCall,
    })),
  ];
  const counts = input.checkpoints.map((checkpoint, index) =>
    countAt(input, people, checkpoint, index),
  );
  const dockTaken = counts.find((count) => count.dive === 0)?.taken ?? false;

  const boardedBlocked: HowItWent["boardedBlocked"] = [];
  for (const diver of input.roster) {
    const blocked = input.countedAboardBlocked.get(diver.bookingId);
    if (!blocked) continue;
    boardedBlocked.push({
      name: diver.fullName,
      dive: diveOf(blocked.checkpoint),
      blockers: blocked.blockers,
    });
  }

  return {
    counts,
    sorted: sortedBeforeBoarding(input, dockTaken),
    turnedAway: input.turnedAway.map((seat) => ({
      name: seat.fullName,
      reason: seat.reason,
      ...(seat.thenBoarded ? { thenBoarded: true as const } : {}),
    })),
    boardedBlocked,
    waivers: waiversOf(input),
  };
}

/**
 * Everyone the desk turned away, whatever the boat recorded first. The departure log lets a seat
 * the boat recorded at any count stay on its roster, so it leaves `turnedAway`; the desk's refusal
 * (and its reason) still stands on the seat's row, and this page names it from there. A seat the
 * crew later boarded is back to `booked` and its row has forgotten the refusal, so `refused`
 * (the refusals the activity trail kept) names it as turned away, then boarded.
 */
export function seatsTurnedAway(
  logged: readonly IncidentTurnedAwayEntry[],
  roster: readonly IncidentRosterEntry[],
  seats: readonly {
    bookingId: string;
    turnedAway?: boolean;
    turnedAwayReason?: TurnAwayReason | null;
  }[],
  refused: ReadonlyMap<string, TurnAwayReason | null> = new Map(),
): (IncidentTurnedAwayEntry & { thenBoarded?: true })[] {
  const named = new Set(logged.map((seat) => seat.bookingId));
  const now = new Map<string, TurnAwayReason | null>();
  for (const seat of seats) {
    if (seat.turnedAway && !named.has(seat.bookingId)) {
      now.set(seat.bookingId, seat.turnedAwayReason ?? now.get(seat.bookingId) ?? null);
    }
  }
  const out: (IncidentTurnedAwayEntry & { thenBoarded?: true })[] = [...logged];
  for (const diver of roster) {
    if (now.has(diver.bookingId)) {
      out.push({
        bookingId: diver.bookingId,
        fullName: diver.fullName,
        reason: now.get(diver.bookingId) ?? null,
      });
    } else if (
      !named.has(diver.bookingId) &&
      refused.has(diver.bookingId) &&
      diver.rollCall.some((result) => result.label === "boarded")
    ) {
      out.push({
        bookingId: diver.bookingId,
        fullName: diver.fullName,
        reason: refused.get(diver.bookingId) ?? null,
        thenBoarded: true,
      });
    }
  }
  return out;
}
