import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
import { formatCalendarDate, isValidCalendarDate } from "@/lib/calendar-date";
import { verifyScheduleMoveResult } from "@/lib/schedule-move-result";
import { noticeFromParam } from "@/lib/staff-notices";

/**
 * What the board says after a builder action, keyed by the `outcome.reason`
 * code the mutation returns (see `moveTrip`/`duplicateTrip`/`deleteTrip` in
 * src/db/trips.ts). Every outcome gets a sentence — including the refusals,
 * which are the interesting ones: a departure that won't move or won't delete
 * is protecting a roster or a head count, and the staff member needs to know
 * which, not just that nothing happened. The message itself is a lookup into
 * the staff bundle, never English baked into this map (docs `i18n-copy` skill).
 */
export const BUILDER_NOTICE_KEYS: Record<
  string,
  { tone: "success" | "danger" | "warning"; key: StaffMessageKey }
> = {
  added: { tone: "success", key: "schedule.notices.added" },
  moved: { tone: "success", key: "schedule.notices.moved" },
  copied: { tone: "success", key: "schedule.notices.copied" },
  // Item 53: the departure copied, its crew refused as a whole.
  "copied-no-crew": { tone: "warning", key: "schedule.notices.copiedNoCrew" },
  // Last year's week, copied onto an empty one (fifth loop, item 30).
  "week-copied": { tone: "success", key: "schedule.notices.weekCopied" },
  "week-not-empty": { tone: "warning", key: "schedule.notices.weekNotEmpty" },
  "nothing-to-copy": { tone: "warning", key: "schedule.notices.nothingToCopy" },
  removed: { tone: "success", key: "schedule.notices.removed" },
  invalid: { tone: "danger", key: "schedule.notices.invalid" },
  "end-before-start": { tone: "danger", key: "schedule.notices.endBeforeStart" },
  // A course's named days, out of order or past six weeks (third UX review, item 10).
  "days-out-of-order": { tone: "danger", key: "schedule.notices.daysOutOfOrder" },
  "days-span-repeat": { tone: "danger", key: "schedule.notices.daysSpanRepeat" },
  "not-authorized": { tone: "danger", key: "schedule.notices.notAuthorized" },
  "not-found": { tone: "danger", key: "schedule.notices.notFound" },
  "not-scheduled": { tone: "warning", key: "schedule.notices.notScheduled" },
  "already-sailed": { tone: "warning", key: "schedule.notices.alreadySailed" },
  "has-roster": { tone: "warning", key: "schedule.notices.hasRoster" },
  "capacity-above-boat": { tone: "danger", key: "schedule.notices.capacityAboveBoat" },
  // A rehearsal is one departure, never a repeating one (ADR 20261012-rehearsal-departures).
  "rehearsal-repeats": { tone: "danger", key: "schedule.notices.rehearsalRepeats" },
  // Loop 5, row 5: the hull is in the yard on that day.
  "boat-out-of-service": { tone: "danger", key: "schedule.notices.boatOutOfService" },
  // Issue #3915, dock review S4: a repeating run refused for a week months out.
  "series-boat-out-of-service": {
    tone: "danger",
    key: "schedule.notices.seriesBoatOutOfService",
  },
  // H-20261009-certificate-caps-seats: the certificate's limit is a ceiling too.
  "capacity-above-certificate": {
    tone: "danger",
    key: "schedule.notices.capacityAboveCertificate",
  },
};

/**
 * The sentence for a builder notice. The certificate refusal names the limit
 * when the redirect carried it (`?count=`, H-20261009-certificate-caps-seats), so the staffer knows the
 * number to type; a URL without one, or with something else there, gets the
 * plain sentence.
 */
export function builderNoticeMessage(
  st: StaffTranslator,
  key: StaffMessageKey,
  count: string | undefined,
  on?: { day: string | undefined; locale: string },
): string {
  if (key === "schedule.notices.seriesBoatOutOfService") {
    // The day comes off the URL: only a real calendar date is named, and a
    // URL without one gets the plain hull-in-the-yard sentence.
    return on?.day && isValidCalendarDate(on.day)
      ? st(key, { date: formatCalendarDate(on.day, on.locale) })
      : st("schedule.notices.boatOutOfService");
  }
  if (key === "schedule.notices.boatOutOfService" && on?.day && isValidCalendarDate(on.day)) {
    // Issue #4026: the first yard day, which need not be the day it leaves.
    return st("schedule.notices.boatOutOfServiceOn", {
      date: formatCalendarDate(on.day, on.locale),
    });
  }
  if (key === "schedule.notices.weekCopied") {
    return st(key, { count: count && /^\d{1,4}$/.test(count) ? Number.parseInt(count, 10) : 0 });
  }
  if (key === "schedule.notices.capacityAboveCertificate" && count && /^\d{1,4}$/.test(count)) {
    return st("schedule.notices.capacityAboveCertificateCount", {
      count: Number.parseInt(count, 10),
    });
  }
  return st(key);
}

/**
 * The board's notice after a builder action, from the redirect's own params:
 * the named form whenever the action passed a title back, the series count
 * when a repeating submission put up several dates. Undefined when `?builder=`
 * names no known outcome. Gear warnings require a separately verified action result.
 */
export function builderNoticeFor({
  builder,
  count,
  created,
  series,
  on,
  locale,
  st,
}: {
  builder: string | undefined;
  count: string | undefined;
  created: string | undefined;
  series: string | undefined;
  /** The shop-local day the notice names (`?on=`), when it names one. */
  on?: string | undefined;
  /** The page's own locale, for the day the notice names. */
  locale: string;
  st: StaffTranslator;
}): { tone: "success" | "danger" | "warning"; message: string } | undefined {
  const builderNoticeEntry = noticeFromParam(builder, BUILDER_NOTICE_KEYS);
  // The named form whenever the action passed a title back; the anonymous
  // "It's on the board" survives for a URL that carries none.
  const seriesCount = series ? Number.parseInt(series, 10) : 0;
  return builderNoticeEntry
    ? {
        tone: builderNoticeEntry.tone,
        message:
          builderNoticeEntry.key === "schedule.notices.added" && created
            ? seriesCount > 1
              ? st("schedule.notices.addedSeries", { title: created, count: seriesCount })
              : st("schedule.notices.addedNamed", { title: created })
            : builderNoticeMessage(st, builderNoticeEntry.key, count, { day: on, locale }),
      }
    : undefined;
}

/** A gear warning exists only when the move action signed its result for this shop. */
export function verifiedGearMoveNotice(
  result: string | undefined,
  shopId: string,
  st: StaffTranslator,
): { id: string; message: string } | null {
  const move = verifyScheduleMoveResult(result, shopId);
  return move && move.gearReleased > 0
    ? {
        id: move.id,
        message: st("schedule.notices.movedGearReleased", { count: move.gearReleased }),
      }
    : null;
}
