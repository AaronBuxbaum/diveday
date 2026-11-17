import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime } from "@/lib/format";
import type { TripSentence } from "./trip-sentence";
import { waterSentence } from "./water-copy";
import type { WaterStanding } from "./water-standing";

/**
 * **What is left to close out once the boat is back** (ADR
 * 20261117-trip-page-clock, Wrapped up), worst first: a roll call that still
 * has people not recorded back (or a dive whose count nobody finished, after
 * people boarded at the dock), no roll call at all, rental units that went
 * out and are not back, a dive whose count was taken but has no log, and an
 * incident report left in draft. Each from a record, never from the clock: a
 * dive with no count is not said to have happened, and it is never read as
 * everyone back either (glossary, "Unaccounted for").
 */
export type CloseOutItem =
  | { kind: "rollCall"; names: string[]; dive: number }
  | { kind: "noRollCall" }
  | { kind: "rentals"; count: number; names: string[] }
  | { kind: "noLog"; dive: number; site: string | null }
  | { kind: "draftReport"; id: string; by: string };

export function closeOutItems({
  standing,
  rentalsOut,
  reports,
  cancelled,
}: {
  standing: WaterStanding;
  /** A cancelled trip nobody boarded has no roll call to take. */
  cancelled: boolean;
  /** Units handed over for a seat on this departure and not back (`listTripUnitsToCheckIn`). */
  rentalsOut: readonly { personName: string }[];
  reports: readonly { id: string; status: string; createdByName: string }[];
}): CloseOutItem[] {
  const items: CloseOutItem[] = [];
  if (standing.notYetBack.length > 0) {
    items.push({
      kind: "rollCall",
      names: standing.notYetBack.map((person) => person.name),
      dive: standing.latest?.dive ?? 0,
    });
  } else if (standing.boarded.length > 0) {
    // People boarded at the dock: the first dive whose count is not finished,
    // started or not, still has every one of them to record back.
    const open = standing.timeline.find((stop) => stop.kind === "dive" && !stop.count?.complete);
    if (open?.kind === "dive") {
      items.push({ kind: "rollCall", names: standing.boarded, dive: open.dive });
    }
  } else if (!cancelled && standing.latest === null) {
    items.push({ kind: "noRollCall" });
  }
  if (rentalsOut.length > 0) {
    items.push({
      kind: "rentals",
      count: rentalsOut.length,
      names: [...new Set(rentalsOut.map((unit) => unit.personName))],
    });
  }
  for (const stop of standing.timeline) {
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
