import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { TripSentence } from "./trip-sentence";
import { waterSentence } from "./water-copy";
import type { WaterStanding } from "./water-standing";

/**
 * **What is left to close out once the boat is back** (ADR
 * 20261117-trip-page-clock, Wrapped up), worst first: a roll call that still
 * has people not recorded back (or a dive whose count nobody finished, after
 * people boarded at the dock), no roll call at all, guests whose flying
 * guidance needs a follow-up, rental units that went
 * out and are not back, a dive whose count was taken but has no log, and an
 * incident report left in draft. Each from a record, never from the clock: a
 * dive with no count is not said to have happened, and it is never read as
 * everyone back either (glossary, "Unaccounted for"). A planned dive the crew
 * recorded not made closes its own roll-call item only (issue #4681).
 */
export type CloseOutItem =
  | { kind: "rollCall"; names: string[]; dive: number }
  | { kind: "noRollCall" }
  | { kind: "flySafe"; names: string[] }
  | { kind: "rentals"; count: number; names: string[] }
  | { kind: "noLog"; dive: number; site: string | null }
  | { kind: "draftReport"; id: string; by: string };

export function closeOutItems({
  standing,
  rentalsOut,
  reports,
  cancelled,
  flySafe = [],
}: {
  /** The roll call's reading, or null when it could not be read: no roll-call items then. */
  standing: WaterStanding | null;
  /** A cancelled trip nobody boarded has no roll call to take. */
  cancelled: boolean;
  /** Units handed over for a seat on this departure and not back (`listTripUnitsToCheckIn`). */
  rentalsOut: readonly { personName: string }[];
  reports: readonly { id: string; status: string; createdByName: string }[];
  /** Guests of this trip whose flying guidance needs a follow-up (`listFlySafeFollowUps`). */
  flySafe?: readonly { name: string }[];
}): CloseOutItem[] {
  const items: CloseOutItem[] = [];
  if (standing) items.push(...rollCallItems(standing, cancelled));
  if (flySafe.length > 0) {
    items.push({ kind: "flySafe", names: [...new Set(flySafe.map((guest) => guest.name))] });
  }
  if (rentalsOut.length > 0) {
    items.push({
      kind: "rentals",
      count: rentalsOut.length,
      names: [...new Set(rentalsOut.map((unit) => unit.personName))],
    });
  }
  for (const stop of standing?.timeline ?? []) {
    if (stop.kind === "dive" && stop.count && !stop.logged) {
      items.push({ kind: "noLog", dive: stop.dive, site: stop.site });
    }
  }
  for (const report of reports) {
    if (report.status === "draft") {
      items.push({ kind: "draftReport", id: report.id, by: report.createdByName });
    }
  }
  return items;
}

/**
 * The roll call's part of what is left, from the latest count anyone started,
 * dock or after a dive:
 *
 * - someone that count has not recorded back comes first;
 * - a dock count left unfinished, or a cancelled trip that put people aboard
 *   at the dock, goes back to the dock count: a boat scrubbed at the dock
 *   made no dive, and an after-dive count would record one;
 * - otherwise the first dive from the latest on whose count is not finished,
 *   started or not, still has everyone that count recorded aboard to record
 *   back, the dock count skipped or not;
 * - no count at all on a trip that ran is "No roll call taken".
 */
function rollCallItems(standing: WaterStanding, cancelled: boolean): CloseOutItem[] {
  const latest = standing.latest;
  if (standing.notYetBack.length > 0) {
    return [
      {
        kind: "rollCall",
        names: standing.notYetBack.map((person) => person.name),
        dive: latest?.dive ?? 0,
      },
    ];
  }
  if (latest === null) return cancelled ? [] : [{ kind: "noRollCall" }];
  const names = standing.lastAboard;
  if (latest.dive === 0 && cancelled) {
    return names.length > 0 ? [{ kind: "rollCall", names, dive: 0 }] : [];
  }
  if (latest.dive === 0 && !latest.complete) return [{ kind: "rollCall", names, dive: 0 }];
  if (latest.aboard === 0) return [];
  // A dive the crew recorded not made, with no count begun, has nobody to
  // count back (issue #4681): it closes that dive's item and no other.
  const open = standing.timeline.find(
    (stop) =>
      stop.kind === "dive" &&
      stop.dive >= latest.dive &&
      !stop.count?.complete &&
      !(stop.notMade && !stop.count),
  );
  if (open?.kind === "dive") return [{ kind: "rollCall", names, dive: open.dive }];
  // No dive follows the dock count (a snorkel or pool day, or dives never
  // planned): never an after-dive checkpoint for a dive that was not planned;
  // the dock count is where each is put ashore by name.
  return latest.dive === 0 && names.length > 0 ? [{ kind: "rollCall", names, dive: 0 }] : [];
}

/**
 * **Where "Not made" is offered** (issue #4681): the dive a close-out
 * roll-call row is about, when that dive is planned, no count of it has begun,
 * and nobody is outstanding: no open missing-diver alert and nobody not
 * recorded back, whose row is never closed this way. Null otherwise. The dock
 * count is never a dive.
 */
export function notMadeOfferFor(
  standing: WaterStanding,
  items: readonly CloseOutItem[],
): number | null {
  if (standing.alerts > 0 || standing.notYetBack.length > 0) return null;
  const row = items.find((item) => item.kind === "rollCall");
  if (row?.kind !== "rollCall" || row.dive < 1) return null;
  const stop = standing.timeline.find((entry) => entry.kind === "dive" && entry.dive === row.dive);
  return stop?.kind === "dive" && stop.count === null ? row.dive : null;
}

/**
 * Wrapped up's sentence: who is not recorded back says so first (the water
 * sentence); a cancelled trip says it is cancelled; otherwise whether the
 * counts have everyone back, or the crew said Home, then what is left.
 */
export function wrappedSentence(
  standing: WaterStanding,
  items: readonly CloseOutItem[],
  fallback: TripSentence,
  {
    locale,
    timeZone,
    cancelled,
    homeSaidAt,
  }: { locale: string; timeZone: string; cancelled: boolean; homeSaidAt: Date | null },
  t: StaffTranslator,
): TripSentence {
  if (standing.alerts > 0 || standing.notYetBack.length > 0) {
    return waterSentence(standing, fallback, { locale, timeZone, cancelled }, t);
  }
  if (cancelled) return fallback;
  const latest = standing.latest;
  // Everyone is back only by the last dive's count, finished; an earlier
  // count says nothing about the dives after it.
  const lastDive = Math.max(
    0,
    ...standing.timeline.flatMap((stop) => (stop.kind === "dive" ? [stop.dive] : [])),
  );
  const lead =
    latest && latest.dive > 0 && latest.dive === lastDive && latest.complete
      ? t("trips.clock.wrapped.everyoneBack")
      : homeSaidAt
        ? t("trips.clock.wrapped.homeSaid", { time: formatTime(homeSaidAt, locale, timeZone) })
        : fallback.headline;
  const left =
    items.length > 0
      ? t("trips.clock.wrapped.closeOut", { count: items.length })
      : t("trips.clock.wrapped.allClosed");
  return {
    headline: `${lead} ${left}`,
    emphasis: items.length > 0 ? t("trips.clock.wrapped.things", { count: items.length }) : null,
    sub: fallback.sub,
  };
}
