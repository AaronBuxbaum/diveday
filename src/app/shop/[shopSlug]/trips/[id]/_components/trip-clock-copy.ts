import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatTime, formatWeekday } from "@/lib/format";
import { CLOCK_PHASES, type ClockPhase, type PhaseWhen } from "@/lib/trip-clock";

/** The phase strip's words, worded once on the server (a staff component takes its words as props). */
export type PhaseStripCopy = {
  label: string;
  phases: Record<ClockPhase, { name: string; short: string; when: string | null }>;
  backToNow: (phase: string) => string;
};

/** A phase's name, in full. */
export function clockPhaseName(t: StaffTranslator, phase: ClockPhase): string {
  return t(`trips.clock.phases.${phase}`);
}

export function phaseStripCopy(
  t: StaffTranslator,
  whens: Record<ClockPhase, PhaseWhen | null>,
  { locale, timeZone }: { locale: string; timeZone: string },
): PhaseStripCopy {
  const whenText = (when: PhaseWhen | null): string | null => {
    if (!when) return null;
    switch (when.kind) {
      case "seats":
        return t("trips.clock.when.seats", { booked: when.booked, capacity: when.capacity });
      case "here":
        return t("trips.clock.when.here", { count: when.count });
      case "done":
        return t("trips.clock.when.done");
      case "now":
        return t("trips.clock.when.now");
      case "day":
        return formatWeekday(when.at, locale, timeZone);
      case "time":
        return formatTime(when.at, locale, timeZone);
    }
  };
  return {
    label: t("trips.clock.label"),
    phases: Object.fromEntries(
      CLOCK_PHASES.map((phase) => [
        phase,
        {
          name: clockPhaseName(t, phase),
          short: t(`trips.clock.short.${phase}`),
          when: whenText(whens[phase]),
        },
      ]),
    ) as PhaseStripCopy["phases"],
    backToNow: (phase) => t("trips.clock.backToNow", { phase }),
  };
}
