import { TRIP_CREW_ROLES, type TripCrewRole } from "./crew-roles";
import { buildCsv, type CsvValue } from "./export";
import { cachedCollator } from "./intl-cache";
import { minorToMajor } from "./money";

/**
 * **The crew sheet a bookkeeper reads** (N-43): per crew member, for one
 * month, the departures they worked, the jobs they did, the hours those
 * departures ran, and their share of the month's tips.
 *
 * **It is not payroll, and nothing here may imply otherwise.** There is no pay
 * rate, no total owed, no deduction and no period. It is display arithmetic
 * over facts the shop already recorded — the same posture the roadmap's tips
 * disclosure takes — handed over as a CSV so a bookkeeper can do the part that
 * is actually their job. A shop that pays its divemasters by the trip and one
 * that pays by the hour both read the same sheet.
 *
 * Framework-free on purpose: the month's rows arrive from `src/db/crew-sheet.ts`
 * and leave as a string the route can stream.
 */

/** One person on one departure, as the month's assignments record it. */
export type CrewSheetAssignment = {
  tripId: string;
  personId: string;
  personName: string;
  /** The job on this sailing; null is "not specified" (ADR 20260803-per-trip-crew-role). */
  tripRole: TripCrewRole | null;
  /**
   * How long that departure ran, in minutes. The reader sums the trip's own
   * scheduled days when it has them, so a three-day course is three working
   * days rather than seventy-two hours.
   */
  minutes: number;
};

/** Paid tips settled against one departure, in the shop's minor units. */
export type CrewSheetTripTips = { tripId: string; amountCents: number };

/** One line of the sheet. `personId` null is the unassigned-tips remainder. */
export type CrewSheetRow = {
  personId: string | null;
  personName: string | null;
  /** Distinct jobs across the month, in `TRIP_CREW_ROLES` order. */
  roles: TripCrewRole[];
  /** True when at least one assignment named no job at all. */
  roleUnspecified: boolean;
  departures: number;
  minutes: number;
  tipsCents: number;
};

/**
 * Split one departure's tips across the people who worked it.
 *
 * Equal shares, and **exact**: the remainder cents go one each to the first
 * few crew in a stable order rather than being dropped, so the column always
 * sums back to the month's tip total. A departure with tips and nobody
 * assigned keeps them — see {@link assembleCrewSheet}, which files them under
 * the unassigned row instead of letting them disappear.
 *
 * Stable order is by `personId`, not by name: two crew members can share a
 * name, and the sheet must produce the same numbers on every run.
 */
export function splitTipsEqually(
  amountCents: number,
  personIds: readonly string[],
): Map<string, number> {
  const split = new Map<string, number>();
  if (personIds.length === 0 || amountCents <= 0) return split;
  const ordered = [...personIds].sort();
  const share = Math.floor(amountCents / ordered.length);
  let remainder = amountCents - share * ordered.length;
  for (const personId of ordered) {
    split.set(personId, share + (remainder > 0 ? 1 : 0));
    if (remainder > 0) remainder -= 1;
  }
  return split;
}

/**
 * The month's rows, in the order the sheet prints them: crew by name, then the
 * unassigned remainder if there is one.
 *
 * A person appears once however many departures they worked; a departure with
 * more than one job for the same person cannot exist (the assignment table is
 * keyed on trip + person), but a person doing different jobs across the month
 * carries all of them.
 */
export function assembleCrewSheet(input: {
  assignments: readonly CrewSheetAssignment[];
  tips: readonly CrewSheetTripTips[];
  locale?: string;
}): CrewSheetRow[] {
  const crewByTrip = new Map<string, string[]>();
  for (const assignment of input.assignments) {
    const crew = crewByTrip.get(assignment.tripId);
    if (crew) crew.push(assignment.personId);
    else crewByTrip.set(assignment.tripId, [assignment.personId]);
  }

  const tipsByPerson = new Map<string, number>();
  let unassignedTipsCents = 0;
  for (const { tripId, amountCents } of input.tips) {
    if (amountCents <= 0) continue;
    const crew = crewByTrip.get(tripId) ?? [];
    if (crew.length === 0) {
      // Nobody was on the crew list for a departure that earned a tip. The
      // money is real and stays on the sheet under its own line: a sheet whose
      // tips column silently fails to add up to the month's tips is worse than
      // one that says "these belong to a boat with no crew recorded".
      unassignedTipsCents += amountCents;
      continue;
    }
    for (const [personId, cents] of splitTipsEqually(amountCents, crew)) {
      tipsByPerson.set(personId, (tipsByPerson.get(personId) ?? 0) + cents);
    }
  }

  const byPerson = new Map<string, CrewSheetRow>();
  for (const assignment of input.assignments) {
    let row = byPerson.get(assignment.personId);
    if (!row) {
      row = {
        personId: assignment.personId,
        personName: assignment.personName,
        roles: [],
        roleUnspecified: false,
        departures: 0,
        minutes: 0,
        tipsCents: tipsByPerson.get(assignment.personId) ?? 0,
      };
      byPerson.set(assignment.personId, row);
    }
    row.departures += 1;
    row.minutes += assignment.minutes;
    if (assignment.tripRole === null) row.roleUnspecified = true;
    else if (!row.roles.includes(assignment.tripRole)) row.roles.push(assignment.tripRole);
  }

  const collator = cachedCollator(input.locale ?? "en-US");
  const rows = [...byPerson.values()].sort((a, b) =>
    collator.compare(a.personName ?? "", b.personName ?? ""),
  );
  for (const row of rows) {
    row.roles.sort((a, b) => TRIP_CREW_ROLES.indexOf(a) - TRIP_CREW_ROLES.indexOf(b));
  }

  if (unassignedTipsCents > 0) {
    rows.push({
      personId: null,
      personName: null,
      roles: [],
      roleUnspecified: false,
      departures: 0,
      minutes: 0,
      tipsCents: unassignedTipsCents,
    });
  }
  return rows;
}

/** Hours to two decimals — a plain number a spreadsheet adds up, never a duration string. */
export function hoursFromMinutes(minutes: number): number {
  return Math.round((minutes / 60) * 100) / 100;
}

/**
 * The sheet as RFC-4180 CSV.
 *
 * Every word a person reads arrives as a parameter, translated by the caller:
 * the header row is copy, and a bookkeeper in Cozumel opens this file in the
 * language their shop reads DiveDay in. The numbers are not: hours and tips
 * are plain decimals in a fixed format so the destination spreadsheet adds
 * them up rather than parsing a localized string, and the currency is its own
 * column rather than a symbol glued to the amount.
 */
export function buildCrewSheetCsv(input: {
  rows: readonly CrewSheetRow[];
  currency: string;
  header: readonly [string, string, string, string, string, string];
  /** The words for each job, and for an assignment that named none. */
  roleLabels: Record<TripCrewRole, string>;
  roleUnspecifiedLabel: string;
  /** The name the unassigned-tips row carries. */
  unassignedLabel: string;
  /** Joins two or more job names in the reader's language. */
  joinRoles: (roles: string[]) => string;
}): string {
  const body: CsvValue[][] = input.rows.map((row) => {
    const roleWords = row.roles.map((role) => input.roleLabels[role]);
    if (row.roleUnspecified) roleWords.push(input.roleUnspecifiedLabel);
    return [
      row.personName ?? input.unassignedLabel,
      roleWords.length > 0 ? input.joinRoles(roleWords) : "",
      row.departures,
      hoursFromMinutes(row.minutes),
      minorToMajor(row.tipsCents, input.currency),
      input.currency.toUpperCase(),
    ];
  });
  return buildCsv([...input.header], body);
}

/**
 * `crew-sheet-<slug>-<YYYY-MM>.csv`. Deliberately not localized: a filename
 * travels through mail clients, file systems and a bookkeeper's folder, and
 * the month key is the one part of it anybody sorts by.
 */
export function crewSheetFileName(shopSlug: string, monthKey: string): string {
  return `crew-sheet-${shopSlug}-${monthKey}.csv`;
}
