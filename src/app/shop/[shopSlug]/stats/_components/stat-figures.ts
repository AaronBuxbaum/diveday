import type { MonthFigure } from "@/app/shop/[shopSlug]/reports/_components/MonthFigures";
import type { OwnerStats } from "@/features/reports/owner-stats";
import { formatPercent } from "@/features/reports/reporting";
import type { StaffTranslator } from "@/i18n/staff-messages";

/** Past two days a count of hours stops being a number a person reads. */
const DAYS_FROM_HOURS = 48;

function ratio(part: number, whole: number): number | null {
  return whole === 0 ? null : part / whole;
}

function medicalValue(medianHours: number | null, t: StaffTranslator): string {
  if (medianHours === null) return t("stats.none");
  if (medianHours >= DAYS_FROM_HOURS) {
    return t("stats.medical.days", { days: Math.round(medianHours / 24) });
  }
  return t("stats.medical.hours", { hours: Math.max(1, Math.round(medianHours)) });
}

/**
 * The four headline figures, in reading order. A figure with nothing behind it reads an em dash
 * and no detail, never "0%".
 */
export function statFigures(stats: OwnerStats, t: StaffTranslator): MonthFigure[] {
  const { repeat, waivers, departures, medical } = stats;
  return [
    {
      key: "repeat",
      label: t("stats.repeat.label"),
      value: formatPercent(ratio(repeat.repeat, repeat.divers)),
      detail:
        repeat.divers === 0
          ? undefined
          : t("stats.repeat.detail", { repeat: repeat.repeat, divers: repeat.divers }),
    },
    {
      key: "waivers",
      label: t("stats.waivers.label"),
      value: formatPercent(ratio(waivers.signedByDeparture, waivers.seats)),
      detail:
        waivers.seats === 0
          ? undefined
          : t("stats.waivers.detail", { signed: waivers.signedByDeparture, seats: waivers.seats }),
    },
    {
      key: "ready",
      label: t("stats.ready.label"),
      value: formatPercent(ratio(departures.ready, departures.counted)),
      detail:
        departures.counted === 0
          ? undefined
          : t("stats.ready.detail", { ready: departures.ready, counted: departures.counted }),
    },
    {
      key: "medical",
      label: t("stats.medical.label"),
      value: medicalValue(medical.medianHours, t),
      detail:
        medical.cleared === 0 && medical.waiting === 0
          ? undefined
          : t("stats.medical.detail", { cleared: medical.cleared, waiting: medical.waiting }),
    },
  ];
}

/** Nothing in any of the five reads: the page says so once instead of drawing zeros. */
export function statsAreEmpty(stats: OwnerStats): boolean {
  return (
    stats.waivers.seats === 0 &&
    stats.repeat.divers === 0 &&
    stats.courses.length === 0 &&
    stats.medical.cleared === 0 &&
    stats.medical.waiting === 0
  );
}
