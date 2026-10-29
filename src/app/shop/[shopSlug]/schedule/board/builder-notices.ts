import type { StaffMessageKey, StaffTranslator } from "@/i18n/staff-messages";
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
  // H-107: the certificate's limit is a ceiling too.
  "capacity-above-certificate": {
    tone: "danger",
    key: "schedule.notices.capacityAboveCertificate",
  },
};

/**
 * The sentence for a builder notice. The certificate refusal names the limit
 * when the redirect carried it (`?count=`, H-107), so the staffer knows the
 * number to type; a URL without one, or with something else there, gets the
 * plain sentence.
 */
export function builderNoticeMessage(
  st: StaffTranslator,
  key: StaffMessageKey,
  count: string | undefined,
): string {
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

/** A gear warning names only a positive, safely represented count. */
export function gearReleasedCount(value: string | undefined): number | undefined {
  if (!value || !/^[1-9]\d*$/.test(value)) return undefined;
  const count = Number(value);
  return Number.isSafeInteger(count) ? count : undefined;
}

/**
 * The board's notice after a builder action, from the redirect's own params:
 * the named form whenever the action passed a title back, the series count
 * when a repeating submission put up several dates, and a warning when a move
 * had to release gear. Undefined when `?builder=` names no known outcome.
 */
export function builderNoticeFor({
  builder,
  count,
  created,
  gear,
  series,
  st,
}: {
  builder: string | undefined;
  count: string | undefined;
  created: string | undefined;
  gear: string | undefined;
  series: string | undefined;
  st: StaffTranslator;
}): { tone: "success" | "danger" | "warning"; message: string } | undefined {
  const builderNoticeEntry = noticeFromParam(builder, BUILDER_NOTICE_KEYS);
  // The named form whenever the action passed a title back; the anonymous
  // "It's on the board" survives for a URL that carries none.
  const seriesCount = series ? Number.parseInt(series, 10) : 0;
  // A move that could not carry its gear onto the new dates reports what it let
  // go of, and in a warning tone rather than the plain success one: the schedule
  // edit worked, and somebody now has kit to reassign on the prep page.
  const gearReleased = gearReleasedCount(gear);
  const movedWithGear =
    builderNoticeEntry?.key === "schedule.notices.moved" && gearReleased !== undefined;
  return builderNoticeEntry
    ? {
        tone: movedWithGear ? ("warning" as const) : builderNoticeEntry.tone,
        message:
          movedWithGear && gearReleased !== undefined
            ? st("schedule.notices.movedGearReleased", { count: gearReleased })
            : builderNoticeEntry.key === "schedule.notices.added" && created
              ? seriesCount > 1
                ? st("schedule.notices.addedSeries", { title: created, count: seriesCount })
                : st("schedule.notices.addedNamed", { title: created })
              : builderNoticeMessage(st, builderNoticeEntry.key, count),
      }
    : undefined;
}
