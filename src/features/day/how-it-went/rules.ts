import type {
  IncidentCrewEntry,
  IncidentExecutedDive,
  IncidentRosterEntry,
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
 * - **Waivers**: how many divers aboard the roster signed ahead, and who
 *   signed on the departure's own date in the shop's zone (a paper release
 *   the desk recorded counts, and says so).
 * - **Sorted before boarding**: for a diver the dock count recorded aboard,
 *   each waiver signed, card checked and rental fit stated on the departure's
 *   date and no later than that dock mark. Then who the desk turned away and
 *   why, and who was counted aboard while readiness still said blocked (the
 *   snapshot the boarding event kept, never recomputed).
 * - **Head counts**: one row per checkpoint, the dock then after each planned
 *   dive, with who was recorded aboard, not back, and not recorded at all.
 *   A count nobody started is `taken: false`; it is never read as everyone
 *   back (glossary, "Unaccounted for").
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
  /** False when nobody recorded anyone at this checkpoint. */
  taken: boolean;
  /** Everyone recorded aboard: divers plus crew. */
  aboard: number;
  crewAboard: number;
  /** Recorded not back aboard after a dive. */
  notBack: string[];
  /** Expected at this count (not left ashore) and with no result at it. */
  notRecorded: string[];
  /** The latest result at this checkpoint and who recorded it. */
  at: string | null;
  by: string | null;
};

export type HowItWent = {
  waivers: {
    ahead: number;
    onTheDay: { name: string; at: string; paper: boolean }[];
    /** Divers on the roster with no signed waiver standing. */
    notSigned: string[];
  };
  sorted: { name: string; fixes: HowItWentFix[] }[];
  turnedAway: { name: string; reason: TurnAwayReason | null }[];
  aboardWithOpenItems: { name: string; checkpoint: string; blockers: ReadinessBlocker[] }[];
  counts: HowItWentCount[];
};

export type HowItWentInput = {
  checkpoints: readonly RollCallCheckpoint[];
  roster: readonly IncidentRosterEntry[];
  crew: readonly IncidentCrewEntry[];
  turnedAway: readonly IncidentTurnedAwayEntry[];
  executedDives: readonly Pick<IncidentExecutedDive, "diveNumber" | "actualSiteName">[];
  /** Seats the dock or a later count recorded aboard while readiness said blocked. */
  countedAboardBlocked: ReadonlyMap<string, CountedAboardBlocked>;
  /** When each seat's rental fit was last stated, by booking; absent or null when none. */
  fitStatedAt: ReadonlyMap<string, Date | null>;
  /** The departure's own date in the shop's zone. */
  day: { from: Date; to: Date };
};

/** A release a staffer recorded watching signed on paper (`src/lib/signatures.ts`). */
const isPaper = (method: string | null) => method?.startsWith("in_person_attested") ?? false;

function onDay(at: string | Date | null | undefined, day: { from: Date; to: Date }) {
  if (!at) return false;
  const ms = new Date(at).getTime();
  return ms >= day.from.getTime() && ms < day.to.getTime();
}

function diveOf(checkpoint: RollCallCheckpoint): number {
  if (checkpoint === "departure") return 0;
  return Number(checkpoint.slice("after_dive_".length));
}

export function howItWent(input: HowItWentInput): HowItWent {
  const { day } = input;
  const named = input.roster.filter((diver) => !diver.identityWithheld);

  let ahead = 0;
  const onTheDay: HowItWent["waivers"]["onTheDay"] = [];
  const notSigned: string[] = [];
  for (const diver of named) {
    const waiver = diver.waiver;
    if (waiver?.state !== "complete" || !waiver.signedAt) {
      notSigned.push(diver.fullName);
      continue;
    }
    if (onDay(waiver.signedAt, day)) {
      onTheDay.push({
        name: diver.fullName,
        at: waiver.signedAt,
        paper: isPaper(waiver.signatureMethod),
      });
    } else if (new Date(waiver.signedAt).getTime() < day.from.getTime()) {
      ahead += 1;
    } else {
      // Signed after the departure's date: a record, but neither ahead nor on the day.
      notSigned.push(diver.fullName);
    }
  }
  onTheDay.sort((a, b) => a.at.localeCompare(b.at));

  const sorted: HowItWent["sorted"] = [];
  for (const diver of named) {
    const dock = diver.rollCall.find((result) => result.checkpoint === "departure");
    if (dock?.label !== "boarded" || !dock.occurredAt) continue;
    const boardedAt = new Date(dock.occurredAt).getTime();
    const before = (at: string | Date | null | undefined): at is string | Date =>
      onDay(at, day) && new Date(at as string | Date).getTime() <= boardedAt;
    const fixes: HowItWentFix[] = [];
    if (diver.waiver?.state === "complete" && before(diver.waiver.signedAt)) {
      fixes.push({ kind: "waiver", at: diver.waiver.signedAt as string });
    }
    const cardAt = diver.certifications
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

  const aboardWithOpenItems: HowItWent["aboardWithOpenItems"] = [];
  for (const diver of input.roster) {
    const blocked = input.countedAboardBlocked.get(diver.bookingId);
    if (!blocked) continue;
    aboardWithOpenItems.push({
      name: diver.fullName,
      checkpoint: blocked.checkpoint,
      blockers: blocked.blockers,
    });
  }

  const people = [
    ...input.roster.map((diver) => ({
      name: diver.fullName,
      crew: false,
      results: diver.rollCall,
    })),
    ...input.crew.map((member) => ({
      name: member.fullName,
      crew: true,
      results: member.rollCall,
    })),
  ];
  const counts = input.checkpoints.map((checkpoint): HowItWentCount => {
    const dive = diveOf(checkpoint);
    let aboard = 0;
    let crewAboard = 0;
    const notBack: string[] = [];
    const notRecorded: string[] = [];
    let latest: { at: string; by: string | null } | null = null;
    for (const person of people) {
      const result = person.results.find((entry) => entry.checkpoint === checkpoint);
      const label = result?.label ?? "awaiting";
      if (label === "awaiting") {
        notRecorded.push(person.name);
        continue;
      }
      if (result?.occurredAt && (!latest || result.occurredAt > latest.at)) {
        latest = { at: result.occurredAt, by: result.recordedByName };
      }
      if (label === "boarded") {
        aboard += 1;
        if (person.crew) crewAboard += 1;
      } else if (label === "not_back_aboard") {
        notBack.push(person.name);
      }
    }
    const taken = latest !== null;
    return {
      checkpoint,
      dive,
      site:
        dive === 0
          ? null
          : (input.executedDives.find((row) => row.diveNumber === dive)?.actualSiteName ?? null),
      taken,
      aboard,
      crewAboard,
      notBack,
      // Before anyone is counted there is nothing to be missing from.
      notRecorded: taken ? notRecorded : [],
      at: latest?.at ?? null,
      by: latest?.by ?? null,
    };
  });

  return {
    waivers: { ahead, onTheDay, notSigned },
    sorted,
    turnedAway: input.turnedAway.map((seat) => ({ name: seat.fullName, reason: seat.reason })),
    aboardWithOpenItems,
    counts,
  };
}
