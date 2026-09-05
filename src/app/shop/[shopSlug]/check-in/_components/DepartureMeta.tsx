import { formatShortDate, formatTimeRange } from "@/lib/format";
import { hasSailed } from "@/lib/trips";

/**
 * **The line under a departure's title on the counter** — its day, its hours,
 * and, once it has gone, the fact that it has gone (ADR
 * 20260827-clearwater-surface-language, decision 9).
 *
 * The word is the point. The arrivals window reaches six hours backwards and
 * `selectFocusedDeparture`'s third rule deliberately keeps a sailed boat in
 * focus for that whole stretch — a late walk-in inside the standing one-hour
 * buffer is real, and skipping ahead to tomorrow's first boat would take the
 * counter away from the one person most likely to need it. What that left
 * without this line was a live "7 of 10 here" and a column of taps for a boat
 * at sea, and at a busy dock the next diver walks up while the previous
 * departure is still the one on screen.
 *
 * The buffer belongs to `hasSailed` and is not re-implemented here: a boat
 * scheduled 55 minutes ago has not gone, because trips run late (AGENTS.md's
 * departure buffer).
 *
 * Ink rather than muted, inside the muted meta line: a state word, not a second
 * heading, and not an alert about the ordinary end of a morning.
 */
export function DepartureMeta({
  startsAt,
  endsAt,
  now,
  locale,
  timeZone,
  departedLabel,
}: {
  startsAt: Date;
  endsAt: Date;
  now: Date;
  locale: string;
  /** The shop's own zone — a departure time is read in the zone it sails from. */
  timeZone: string;
  /** The word for a boat that has left, from the page's bundle. */
  departedLabel: string;
}) {
  return (
    <>
      {formatShortDate(startsAt, locale, timeZone)} ·{" "}
      {formatTimeRange(startsAt, endsAt, locale, timeZone)}
      {hasSailed(startsAt, now) ? (
        <>
          {" · "}
          <span className="font-medium text-foreground">{departedLabel}</span>
        </>
      ) : null}
    </>
  );
}
