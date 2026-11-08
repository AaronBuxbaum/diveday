import type { AppDb } from "@/db/client";
import { listStaff } from "@/db/trips";
import { lastSafetyDrills, listSafetyDrills } from "@/features/safety-drills";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { isoDate, type MonthRef, monthKey } from "@/lib/calendar";
import {
  calendarDateInTimezone,
  calendarDateToUtcMidnight,
  calendarDaysBetween,
  shiftCalendarDateMonths,
} from "@/lib/calendar-date";
import { nowDate } from "@/lib/clock";
import { formatShortDate } from "@/lib/format";
import { cachedListFormat } from "@/lib/intl-cache";
import {
  DRILL_BACKDATE_MONTHS,
  DRILL_KINDS,
  DRILL_NOTE_MAX,
  type DrillKind,
} from "@/lib/safety-drills";

/** The words for one drill kind, DiveDay's, from the incidents bundle. */
export function drillKindLabel(t: StaffTranslator, kind: DrillKind): string {
  return t(`incidents.safety.drills.kinds.${kind}`);
}

/**
 * **The drill log on the Safety tab** (loop 5, row 2): how long since each
 * kind of drill, the drills held in the month being read, and what the
 * "Log a drill" form needs (the shop's staff, today). Composed once for the
 * screen and the printed sheet; the sheet draws no form.
 */
export async function readDrillLog({
  db,
  shopId,
  timeZone,
  month,
  locale,
  t,
}: {
  db: AppDb;
  shopId: string;
  timeZone: string;
  /** The month being read, or null for the year view, which lists no drills. */
  month: MonthRef | null;
  locale: string;
  t: StaffTranslator;
}) {
  const today = calendarDateInTimezone(nowDate(), timeZone);
  const [last, held, staff] = await Promise.all([
    lastSafetyDrills(db, shopId),
    month
      ? listSafetyDrills(db, shopId, {
          from: isoDate(month.year, month.month, 1),
          to: isoDate(
            month.year,
            month.month,
            new Date(Date.UTC(month.year, month.month, 0)).getUTCDate(),
          ),
        })
      : [],
    listStaff(db, shopId),
  ]);
  const names = cachedListFormat(locale, { type: "conjunction" });
  return {
    title: t("incidents.safety.drills.title"),
    since: DRILL_KINDS.map((kind) => {
      const heldOn = last.get(kind);
      const label = drillKindLabel(t, kind);
      return {
        kind,
        never: !heldOn,
        text: heldOn
          ? t("incidents.safety.drills.lastHeld", {
              kind: label,
              days: calendarDaysBetween(heldOn, today),
            })
          : t("incidents.safety.drills.neverHeld", { kind: label }),
      };
    }),
    heldTitle: t("incidents.safety.drills.heldTitle"),
    held: held.map((drill) => ({
      id: drill.id,
      line: `${formatShortDate(calendarDateToUtcMidnight(drill.heldOn), locale, "UTC")} · ${drillKindLabel(t, drill.kind)}`,
      people: drill.participants.length > 0 ? names.format(drill.participants) : null,
      note: drill.note,
      logged: t("incidents.safety.drills.loggedBy", {
        name: drill.recordedBy,
        date: formatShortDate(drill.recordedAt, locale, timeZone),
      }),
    })),
    form: {
      month: month ? monthKey(month) : null,
      today,
      earliest: shiftCalendarDateMonths(today, -DRILL_BACKDATE_MONTHS),
      noteMax: DRILL_NOTE_MAX,
      kinds: DRILL_KINDS.map((kind) => ({ value: kind, label: drillKindLabel(t, kind) })),
      staff: staff.map((member) => ({ id: member.person.id, name: member.person.fullName })),
      copy: {
        logTitle: t("incidents.safety.drills.logTitle"),
        kindLabel: t("incidents.safety.drills.kindLabel"),
        dateLabel: t("incidents.safety.drills.dateLabel"),
        peopleLabel: t("incidents.safety.drills.peopleLabel"),
        noteLabel: t("incidents.safety.drills.noteLabel"),
        optional: t("incidents.safety.drills.optional"),
        submit: t("incidents.safety.drills.submit"),
        delete: t("incidents.safety.drills.delete"),
        deleteConfirm: t("incidents.safety.drills.deleteConfirm"),
        deleting: t("words.busy.deleting"),
        saving: t("words.busy.saving"),
      },
    },
  };
}

export type DrillLogView = Awaited<ReturnType<typeof readDrillLog>>;
