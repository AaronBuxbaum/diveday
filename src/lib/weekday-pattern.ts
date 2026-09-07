/**
 * The add panel already knows the weekday (ADR 20260906-before-you-ask,
 * decision 3).
 *
 * Given what a shop ran on the same weekday over the last six weeks, the
 * pattern is the departure that recurs: the start time most of those days
 * carried, and for each field the value most of *those* departures agreed on.
 * A field with no majority stays empty — the panel never guesses. A shop with
 * fewer than three such days has no pattern and sees the blank panel. A second
 * start time most of the days also carried is offered as one row, with its own
 * fields, and is never added on its own.
 *
 * Framework-free: the reader (`src/db/weekday-pattern.ts`) hands in rows, and
 * the panel fills fields from what comes back.
 */
export const PATTERN_WEEKS = 6;
/** How many of the sampled days must agree before a value is offered. */
export const PATTERN_MIN_AGREEING = 3;

export type WeekdayDeparture = {
  /** The local calendar date the departure left on; one day may hold several rows. */
  date: string;
  /** Wall-clock `HH:MM` in the shop's zone. */
  startTime: string;
  endTime: string;
  title: string;
  diveSiteId: string | null;
  boatId: string | null;
  capacity: number;
  priceCents: number | null;
  lensId: string | null;
  diveMode: string | null;
  crewPersonIds: string[];
};

/** One recurring departure: the majority value per field, empty where the days disagreed. */
export type PatternDeparture = {
  startTime: string;
  /** How many distinct days this start time ran on. */
  days: number;
  endTime: string | null;
  title: string | null;
  diveSiteId: string | null;
  boatId: string | null;
  capacity: number | null;
  priceCents: number | null;
  lensId: string | null;
  diveMode: string | null;
  /** The crew aboard on most of those days, most frequent first. */
  crewPersonIds: string[];
};

export type WeekdayPattern = PatternDeparture & {
  /** How many distinct days the pattern was read from. */
  sampledDays: number;
  /** A second departure most of those days also carried. */
  alsoUsual: PatternDeparture | null;
};

function modeOf<T extends string | number>(
  values: readonly (T | null)[],
  minimum: number,
): T | null {
  const counts = new Map<T, number>();
  for (const value of values) {
    if (value === null || value === "") continue;
    counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  let best: T | null = null;
  let bestCount = 0;
  for (const [value, count] of counts) {
    if (count > bestCount) {
      best = value;
      bestCount = count;
    }
  }
  return bestCount >= minimum ? best : null;
}

type Group = { startTime: string; rows: WeekdayDeparture[]; days: number };

/** Departures grouped by start time, most days first. */
function groupByStart(rows: readonly WeekdayDeparture[]): Group[] {
  const groups = new Map<string, { rows: WeekdayDeparture[]; days: Set<string> }>();
  for (const row of rows) {
    const group = groups.get(row.startTime) ?? { rows: [], days: new Set() };
    group.rows.push(row);
    group.days.add(row.date);
    groups.set(row.startTime, group);
  }
  return [...groups.entries()]
    .map(([startTime, group]) => ({ startTime, rows: group.rows, days: group.days.size }))
    .sort((a, b) => b.days - a.days || a.startTime.localeCompare(b.startTime));
}

function patternOf(group: Group, minimum: number): PatternDeparture {
  const agree = <T extends string | number>(pick: (row: WeekdayDeparture) => T | null) =>
    modeOf(
      group.rows.map((row) => pick(row)),
      minimum,
    );
  // Crew: everyone who was aboard on at least `minimum` of the days, most
  // frequent first, so a regular pair comes back as the pair.
  const crewCounts = new Map<string, number>();
  for (const row of group.rows) {
    for (const personId of new Set(row.crewPersonIds)) {
      crewCounts.set(personId, (crewCounts.get(personId) ?? 0) + 1);
    }
  }
  const crewPersonIds = [...crewCounts.entries()]
    .filter(([, count]) => count >= minimum)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([personId]) => personId);
  return {
    startTime: group.startTime,
    days: group.days,
    endTime: agree((row) => row.endTime),
    title: agree((row) => row.title),
    diveSiteId: agree((row) => row.diveSiteId),
    boatId: agree((row) => row.boatId),
    capacity: agree((row) => row.capacity),
    priceCents: agree((row) => row.priceCents),
    lensId: agree((row) => row.lensId),
    diveMode: agree((row) => row.diveMode),
    crewPersonIds,
  };
}

export function weekdayPattern(
  rows: readonly WeekdayDeparture[],
  minimum = PATTERN_MIN_AGREEING,
): WeekdayPattern | null {
  const sampledDays = new Set(rows.map((row) => row.date)).size;
  if (sampledDays < minimum) return null;
  const [primary, second] = groupByStart(rows);
  if (!primary || primary.days < minimum) return null;
  return {
    ...patternOf(primary, minimum),
    sampledDays,
    alsoUsual: second && second.days >= minimum ? patternOf(second, minimum) : null,
  };
}
