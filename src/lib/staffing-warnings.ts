import {
  type CalendarDate,
  calendarDateInTimezone,
  isCalendarDateExpired,
  isValidCalendarDate,
  shiftCalendarDate,
} from "./calendar-date";
import { credentialIssuedBy, lastDayOfDeparture, RUNG_EVIDENCE_KINDS } from "./crew-roles";
import { hasReturned } from "./trips";
import { parseWallTime, wallTimeToUtc } from "./zoned";

/**
 * **What the staffing week warns about** (batch 4, D3): three facts about the
 * crew a manager building the week would want to see before the morning, and
 * nothing that refuses anything.
 *
 * - **A departure with nobody first-aid ready aboard.** Two separate checks:
 *   no crew member holds a current `oxygen_provider` credential on the day it
 *   runs, and no crew member holds a current `first_aid_cpr` one. Each is its
 *   own warning.
 * - **A long day.** The departures one person crews cover more than
 *   {@link LONG_DAY_HOURS} hours of one shop-local day. Only crewed departures
 *   count: a shift is availability (when somebody can be called on), not duty,
 *   so a long shift around one short boat is a short day.
 * - **An expired credential on somebody crewing.** Any recorded credential of
 *   theirs whose every record of that kind has lapsed by the day they crew,
 *   except the dive-professional ratings ({@link RUNG_EVIDENCE_KINDS}): the
 *   supervision claim already marks those lapsed on the departure's crew, and
 *   one lapse said twice is noise.
 *
 * Warning-only, like every reading of `staff_credentials` (H-59): the booking
 * gate and the crew editor never call this. Codes, never sentences; the words
 * are `src/i18n/staffing-warning-labels.ts`.
 *
 * Two silences are deliberate, and both follow `lapsedRungs`
 * (`src/lib/crew-roles.ts`):
 *
 * - **A shop that records no credential of a kind is never warned about it.**
 *   Most shops record nothing; reading silence as "nobody aboard is O2
 *   trained" would put a line on every departure the day this shipped, and a
 *   warning on every boat is a warning on none.
 * - **A credential with no renewal date (or one that is not a real date) is
 *   current.** It has nothing to say about currency.
 */

/** More than this many hours on duty in one day is a long day. */
export const LONG_DAY_HOURS = 12;

/** The credentials a departure should have at least one holder of aboard, in the order they are checked. */
export const ABOARD_CREDENTIAL_KINDS = ["oxygen_provider", "first_aid_cpr"] as const;
export type AboardCredentialKind = (typeof ABOARD_CREDENTIAL_KINDS)[number];

/** One recorded credential, as much of it as currency needs. */
export type WarningCredential = { kind: string; issuedAt?: string | null; renewsAt: string | null };

/** One meeting of a departure: a window somebody crewing it is on duty. */
export type WorkWindow = { startsAt: Date; endsAt: Date };

export type WarningDeparture = {
  tripId: string;
  title: string;
  /** Every window it meets in, ascending. Never empty. */
  meetings: readonly WorkWindow[];
  /** Who is rostered on it. */
  crew: readonly string[];
};

export type WarningPerson = {
  personId: string;
  name: string;
  credentials: readonly WarningCredential[];
};

export type StaffingWarning =
  | {
      code: "missing_aboard";
      kind: AboardCredentialKind;
      tripId: string;
      title: string;
      startsAt: Date;
    }
  | { code: "long_day"; personId: string; name: string; day: CalendarDate; minutes: number }
  | {
      code: "credential_not_yet_issued";
      personId: string;
      name: string;
      kind: string;
      issuedAt: CalendarDate;
      tripId: string;
      title: string;
    }
  | {
      code: "credential_expired";
      personId: string;
      name: string;
      kind: string;
      renewsAt: CalendarDate;
      tripId: string;
      title: string;
    };

/**
 * Whether `credentials` hold a current `kind` on `day`: at least one record
 * of it, and at least one of those undated or renewing on or after `day`.
 */
export function holdsCurrent(
  credentials: readonly WarningCredential[],
  kind: string,
  day: CalendarDate,
  firstDay: CalendarDate = day,
): boolean {
  return credentials.some(
    (credential) =>
      credential.kind === kind &&
      credentialIssuedBy(credential.issuedAt, firstDay) &&
      (credential.renewsAt === null ||
        !isValidCalendarDate(credential.renewsAt) ||
        !isCalendarDateExpired(credential.renewsAt, day)),
  );
}

/**
 * The kinds a person's records say they are **off** on `day`: recorded, and
 * every record of the kind dated and expired. Each carries the latest renewal
 * date among them, which is the one worth printing. Sorted by kind.
 */
export function expiredKinds(
  credentials: readonly WarningCredential[],
  day: CalendarDate,
  firstDay: CalendarDate = day,
): { kind: string; renewsAt: CalendarDate }[] {
  const kinds = [...new Set(credentials.map((credential) => credential.kind))].sort();
  const out: { kind: string; renewsAt: CalendarDate }[] = [];
  for (const kind of kinds) {
    if (holdsCurrent(credentials, kind, day, firstDay)) continue;
    const dates = credentials
      .filter(
        (credential) => credential.kind === kind && credentialIssuedBy(credential.issuedAt, day),
      )
      .map((credential) => credential.renewsAt as CalendarDate)
      .sort();
    const latest = dates[dates.length - 1];
    if (latest) out.push({ kind, renewsAt: latest });
  }
  return out;
}

/** The instants a shop-local calendar day covers, `[from, to)`. */
function dayBounds(day: CalendarDate, timeZone: string): { from: number; to: number } | null {
  const start = parseWallTime(day, "00:00");
  const end = parseWallTime(shiftCalendarDate(day, 1), "00:00");
  if (!start || !end) return null;
  return {
    from: wallTimeToUtc(start, timeZone).getTime(),
    to: wallTimeToUtc(end, timeZone).getTime(),
  };
}

/** Every shop-local day a window touches, first to last. */
function daysTouched(window: WorkWindow, timeZone: string): CalendarDate[] {
  if (window.endsAt.getTime() <= window.startsAt.getTime()) return [];
  const first = calendarDateInTimezone(window.startsAt, timeZone);
  const last = calendarDateInTimezone(new Date(window.endsAt.getTime() - 1), timeZone);
  const days: CalendarDate[] = [];
  // Bounded: a departure meeting is never longer than a few days,
  // and the guard keeps a corrupt row from spinning.
  for (let day = first; day <= last && days.length < 31; day = shiftCalendarDate(day, 1)) {
    days.push(day);
  }
  return days;
}

/**
 * Minutes of `day` covered by the **union** of `windows`, not their sum: a
 * captain's 07:00–15:00 departure and an 08:00–12:00 one they also crew are eight
 * hours on duty, not twelve.
 */
export function minutesOnDuty(
  windows: readonly WorkWindow[],
  day: CalendarDate,
  timeZone: string,
): number {
  const bounds = dayBounds(day, timeZone);
  if (!bounds) return 0;
  const clipped = windows
    .map((window) => ({
      from: Math.max(window.startsAt.getTime(), bounds.from),
      to: Math.min(window.endsAt.getTime(), bounds.to),
    }))
    .filter((window) => window.to > window.from)
    .sort((a, b) => a.from - b.from);
  let total = 0;
  let cursor = Number.NEGATIVE_INFINITY;
  for (const window of clipped) {
    const from = Math.max(window.from, cursor);
    if (window.to > from) total += window.to - from;
    cursor = Math.max(cursor, window.to);
  }
  return Math.floor(total / 60_000);
}

/**
 * The week's warnings, departures first in departure order, then people by
 * name. A departure already home, and a day already behind the shop's today,
 * are nobody's to act on and say nothing.
 */
export function staffingWarnings(input: {
  departures: readonly WarningDeparture[];
  people: readonly WarningPerson[];
  timeZone: string;
  now: Date;
}): StaffingWarning[] {
  const { timeZone, now } = input;
  const today = calendarDateInTimezone(now, timeZone);
  const byId = new Map(input.people.map((person) => [person.personId, person]));
  const recordedKinds = new Set(
    input.people.flatMap((person) => person.credentials.map((credential) => credential.kind)),
  );

  const upcoming = input.departures
    .filter((departure) => departure.meetings.length > 0)
    .filter((departure) => {
      const last = departure.meetings[departure.meetings.length - 1];
      return last ? !hasReturned(last.endsAt, now) : false;
    })
    .sort(
      (a, b) =>
        (a.meetings[0]?.startsAt.getTime() ?? 0) - (b.meetings[0]?.startsAt.getTime() ?? 0) ||
        (a.title < b.title ? -1 : a.title > b.title ? 1 : 0) ||
        (a.tripId < b.tripId ? -1 : a.tripId > b.tripId ? 1 : 0),
    );

  const warnings: StaffingWarning[] = [];

  for (const departure of upcoming) {
    // Nobody rostered is already "Needs crew" on the week; a second line
    // saying nobody aboard holds O2 would be the same gap twice.
    if (departure.crew.length === 0) continue;
    const first = departure.meetings[0];
    const last = departure.meetings[departure.meetings.length - 1];
    if (!first || !last) continue;
    const day = lastDayOfDeparture(last.endsAt, timeZone);
    for (const kind of ABOARD_CREDENTIAL_KINDS) {
      if (!recordedKinds.has(kind)) continue;
      const covered = departure.crew.some((personId) =>
        holdsCurrent(
          byId.get(personId)?.credentials ?? [],
          kind,
          day,
          calendarDateInTimezone(first.startsAt, timeZone),
        ),
      );
      if (!covered) {
        warnings.push({
          code: "missing_aboard",
          kind,
          tripId: departure.tripId,
          title: departure.title,
          startsAt: first.startsAt,
        });
      }
    }
  }

  const people = [...input.people].sort(
    (a, b) =>
      (a.name < b.name ? -1 : a.name > b.name ? 1 : 0) ||
      (a.personId < b.personId ? -1 : a.personId > b.personId ? 1 : 0),
  );
  for (const person of people) {
    const crewing = upcoming.filter((departure) => departure.crew.includes(person.personId));

    // Long days: every day this person crews, from today on. Shifts are
    // availability, not duty, and never count.
    const windows: WorkWindow[] = crewing.flatMap((departure) => departure.meetings);
    const days = [...new Set(windows.flatMap((window) => daysTouched(window, timeZone)))]
      .filter((day) => day >= today)
      .sort();
    for (const day of days) {
      const minutes = minutesOnDuty(windows, day, timeZone);
      if (minutes > LONG_DAY_HOURS * 60) {
        warnings.push({
          code: "long_day",
          personId: person.personId,
          name: person.name,
          day,
          minutes,
        });
      }
    }

    // Expired credentials: once per kind, against the first departure it
    // lapses before.
    const said = new Set<string>();
    const futureSaid = new Set<string>();
    for (const departure of crewing) {
      const first = departure.meetings[0];
      const last = departure.meetings[departure.meetings.length - 1];
      if (!first || !last) continue;
      const firstDay = calendarDateInTimezone(first.startsAt, timeZone);
      const day = lastDayOfDeparture(last.endsAt, timeZone);
      for (const credential of person.credentials) {
        if (
          !credential.issuedAt ||
          !isValidCalendarDate(credential.issuedAt) ||
          credential.issuedAt <= firstDay ||
          futureSaid.has(credential.kind) ||
          holdsCurrent(person.credentials, credential.kind, day, firstDay)
        )
          continue;
        futureSaid.add(credential.kind);
        warnings.push({
          code: "credential_not_yet_issued",
          personId: person.personId,
          name: person.name,
          kind: credential.kind,
          issuedAt: credential.issuedAt,
          tripId: departure.tripId,
          title: departure.title,
        });
      }
      for (const expired of expiredKinds(person.credentials, day, firstDay)) {
        if (RUNG_EVIDENCE_KINDS.includes(expired.kind)) continue;
        if (said.has(expired.kind)) continue;
        said.add(expired.kind);
        warnings.push({
          code: "credential_expired",
          personId: person.personId,
          name: person.name,
          kind: expired.kind,
          renewsAt: expired.renewsAt,
          tripId: departure.tripId,
          title: departure.title,
        });
      }
    }
  }

  return warnings;
}
