import { SECTION_TITLE_CLASS } from "@/components/ui/typography";
import type { StaffTranslator } from "@/i18n/staff-messages";
import { formatDateTimeTz } from "@/lib/format";
import { type MinimumSeatsPolicy, minimumSeatsState } from "@/lib/minimum-seats";

/**
 * Where a departure stands against the head count it needs to run.
 *
 * Renders **nothing** for a trip with no minimum, which is every trip that
 * exists today — and nothing for one that has met it, because "this is going
 * ahead" is what a scheduled departure already means and a band saying so on
 * every filled boat is the absence of news formatted as news (principle 9).
 *
 * It speaks up for the two states a shop can act on. *Short* is the working
 * state: how many seats short, and the moment the answer is due, which is the
 * window in which ringing round the regulars still saves the day. *Due* is the
 * hour after that moment and before the sweep's next pass — the departure is
 * about to be cancelled and its divers emailed, and a staffer who wants to run
 * it anyway has until then to raise the seat count or clear the minimum from
 * Details. Both are the same news at different urgencies, so they are one band
 * in two tones rather than two components.
 */
export function MinimumSeatsBand({
  trip,
  booked,
  locale,
  timeZone,
  t,
}: {
  trip: MinimumSeatsPolicy & { startsAt: Date; capacity: number };
  booked: number;
  locale: string;
  timeZone: string;
  t: StaffTranslator;
}) {
  const state = minimumSeatsState(trip, booked);
  if (state.kind === "none" || state.kind === "met") return null;
  const due = state.kind === "due";
  const deadline = formatDateTimeTz(state.decidesAt, locale, timeZone);
  return (
    <section
      className={`mt-6 rounded-panel border p-5 ${
        due ? "border-danger/40 bg-danger/10" : "border-warning/40 bg-warning/10"
      }`}
    >
      <p
        className={`text-xs font-semibold tracking-widest uppercase ${
          due ? "text-danger" : "text-warning-strong"
        }`}
      >
        {t("trips.minimumSeats.eyebrow")}
      </p>
      <h2 className={`mt-1 ${SECTION_TITLE_CLASS}`}>
        {t("trips.minimumSeats.heading", { shortfall: state.shortfall, minimum: state.minimum })}
      </h2>
      <p className="mt-1 max-w-prose text-sm text-muted">
        {due
          ? t("trips.minimumSeats.dueBody", { deadline })
          : t("trips.minimumSeats.shortBody", { deadline })}
      </p>
    </section>
  );
}
