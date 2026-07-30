import { birthdayText } from "@/i18n/birthday-labels";
import { staffTranslator } from "@/i18n/staff-messages";
import { type BirthdayCallout, birthdayCallout } from "@/lib/age";
import type { CalendarDate } from "@/lib/calendar-date";
import type { RosterEntry } from "./types";

/**
 * The one warm thing on a page otherwise made of gates and blockers: who on
 * this boat has a birthday today or in the next few days (H-21).
 *
 * Renders nothing at all when there is nothing to celebrate — an empty
 * "no birthdays" panel would be chrome on every other trip, and a
 * window this short is what keeps the callout rare enough to notice.
 */
export function CelebrationsSection({
  roster,
  tripDate,
  locale,
}: {
  roster: RosterEntry[];
  /** The trip's own shop-local calendar date; birthdays are measured on it. */
  tripDate: CalendarDate;
  locale: string;
}) {
  const t = staffTranslator(locale);
  const celebrating = roster
    .map(({ booking, person }) => ({
      bookingId: booking.id,
      name: person.fullName,
      callout: birthdayCallout(person.dateOfBirth, tripDate),
    }))
    .filter(
      (entry): entry is { bookingId: string; name: string; callout: BirthdayCallout } =>
        entry.callout !== null,
    )
    // Today first, then nearest — the crew reads the top line and acts on it.
    .sort((a, b) => calloutDays(a.callout) - calloutDays(b.callout));

  if (celebrating.length === 0) return null;

  return (
    <section className="mt-6 rounded-lg border border-primary/30 bg-primary/5 p-6">
      <h2 className="font-medium">
        <span aria-hidden="true">🎂</span> {t("trips.celebrations.heading")}
      </h2>
      <p className="mt-1 text-sm text-muted">{t("trips.celebrations.description")}</p>
      <ul className="mt-4 grid gap-2">
        {celebrating.map((entry) => (
          <li key={entry.bookingId} className="text-sm">
            <span className="font-medium">{entry.name}</span>{" "}
            <span className="text-muted">{birthdayText(t, entry.callout)}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}

/**
 * Sort key: today first, then nearest upcoming, then most recently past. The
 * crew reads the top line and acts on it, so "today" must never sit below
 * "6d ago".
 */
function calloutDays(callout: BirthdayCallout): number {
  if (callout.status === "today") return 0;
  return callout.status === "soon" ? callout.inDays : 1_000 + callout.daysAgo;
}
