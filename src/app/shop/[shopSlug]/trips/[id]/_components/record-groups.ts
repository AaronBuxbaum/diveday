import { joinedAtADiveSite, readSeatLadder, sailingUnsaid } from "@/features/seat-ladder";
import type { StaffTranslator } from "@/i18n/staff-messages";
import type { RosterRecord } from "./roster-model";
import type { RosterEntry } from "./types";

/** The seats one after-dive count left out, on the record (issue #3895). */
export type NotCountedAfterDiveGroup = { dive: number; entries: RosterEntry[] };

/**
 * **The record's groups**, one seat at a time by its rung on the seat ladder
 * (`readSeatLadder`, src/features/seat-ladder/rules.ts) and `seatSailed`, the rule the
 * evening close-out counts by (dive-domain review of UX batch 1):
 *
 * - **Sailed**: boarded at the dock, or counted at an after-dive checkpoint
 *   (a diver picked up at the second site sailed, and that count outranks a
 *   desk's `no_show`).
 * - **Didn't sail**: only what somebody said: the crew's `not_boarded` at the
 *   dock, or a released seat (`no_show`) nobody counted aboard.
 * - **Joined at a dive site**: a dock `not_boarded`, then counted after a dive
 *   (a chase boat, #3823): not Sailed by the vessel, but dived (rung `out`).
 * - **Not counted at the dock**: a seat nobody said anything about on a
 *   departure whose roll call was taken. Silence is not "didn't sail".
 * - **No roll call taken**: the same silence on a departure with no dock roll
 *   call at all, under a band that says so rather than a guess.
 * - **Not back aboard**: said missing at an after-dive checkpoint and not
 *   counted since. Ahead of every other group, and the departure stays open
 *   while one is here (`departureStage`, issue #2404).
 * - **Not counted after dive N**: a seat that would read Sailed, but a started
 *   after-dive count never included it and no later count did (issue #3895).
 *   Never moved into Not back aboard: nobody said they were missing.
 *
 * Nothing is still to clear, nothing is blocked, and no shared advisory is
 * said: the dive is over (dive-domain rule: a record never asks for action).
 */
export function recordGroups(t: StaffTranslator, roster: RosterEntry[], record: RosterRecord) {
  const sailed: RosterEntry[] = [];
  const didNotSail: RosterEntry[] = [];
  const joinedAtSite: RosterEntry[] = [];
  const uncounted: RosterEntry[] = [];
  const unrecorded: RosterEntry[] = [];
  const turnedAway: RosterEntry[] = [];
  const unaccounted: RosterEntry[] = [];
  const notCounted = new Map<number, RosterEntry[]>();
  for (const entry of roster) {
    const id = entry.booking.id;
    const noShow = entry.booking.status === "no_show";
    // No arrival: the record files what the crew and the desk said about
    // sailing, and an arrival moves no seat between its groups (the ladder's
    // "changes nothing but booked to arrived" test).
    const ladder = readSeatLadder({
      noShow,
      arrived: false,
      dockResult: record.dock.get(id) ?? null,
      afterDiveResultStands: record.afterDive.has(id),
      missingAfterDive: record.unaccounted.has(id),
    });
    // First: the one group that is still a question, whatever else is on file.
    const notCountedAfter = record.notCountedAfterDive?.get(id);
    if (ladder.rung === "missing") {
      unaccounted.push(entry);
    } else if (notCountedAfter !== undefined) {
      notCounted.set(notCountedAfter, [...(notCounted.get(notCountedAfter) ?? []), entry]);
    } else if (sailingUnsaid(ladder)) {
      (record.rollCallTaken ? uncounted : unrecorded).push(entry);
    } else if (ladder.countsAsSailed) {
      sailed.push(entry);
    } else if (joinedAtADiveSite(ladder, record.dock.get(id) ?? null)) {
      joinedAtSite.push(entry);
    } else if (noShow && entry.booking.turnedAwayAt) {
      // Did not sail because the desk refused them (H-20261015-who-may-turn-someone), said apart from
      // the divers who never came.
      turnedAway.push(entry);
    } else {
      didNotSail.push(entry);
    }
  }
  return {
    stillToClear: [] as RosterEntry[],
    ready: [] as RosterEntry[],
    here: [] as RosterEntry[],
    notHere: [] as RosterEntry[],
    turnedAway,
    deskWorkOpen: false,
    hereMeta: undefined as string | undefined,
    blockedCount: 0,
    sharedFacts: [] as { sentence: string; count: number }[],
    sharedAdvisoryTexts: new Set<string>(),
    sailed,
    didNotSail,
    joinedAtSite,
    uncounted,
    unrecorded,
    unaccounted,
    notCountedAfterDive: [...notCounted]
      .sort(([a], [b]) => a - b)
      .map(([dive, entries]) => ({ dive, entries })),
    // The group's fact, said once (principle 9): how many of those who sailed
    // were counted aboard while blocked. Nothing at all when none were.
    sailedMeta: countedBlockedMeta(t, sailed, record),
  };
}

function countedBlockedMeta(
  t: StaffTranslator,
  sailed: readonly RosterEntry[],
  record: RosterRecord,
): string | undefined {
  const count = sailed.filter(({ booking }) => record.countedAboardBlocked.has(booking.id)).length;
  return count === 0 ? undefined : t("trips.roster.sailedBlockedMeta", { count });
}
