import type { StaffTranslator } from "@/i18n/staff-messages";
import { bookingIsAhead } from "@/lib/diver-status";
import { formatShortDate, formatTime } from "@/lib/format";
import type { SavedAnswerFill } from "@/lib/saved-answers";
import type { DiverProfile } from "../_components/shared";

/**
 * What a saved answer's `{name}` and `{trip}` become on this record (fifth
 * loop, item 15): the first name, and the departure this diver is next booked
 * on. Either is null when the record has none, and the chip leaves its marker.
 */
export function savedAnswerFillFor(
  diver: DiverProfile,
  now: Date,
  t: StaffTranslator,
  locale: string,
  timezone: string,
): SavedAnswerFill {
  const nextBooked = diver.bookings
    .filter((entry) => entry.booking.status === "booked" && bookingIsAhead(entry, now))
    .sort((a, b) => a.trip.startsAt.getTime() - b.trip.startsAt.getTime())[0];
  return {
    name: diver.person.fullName.trim().split(/\s+/)[0] || null,
    trip: nextBooked
      ? t("inbox.savedAnswers.tripFill", {
          title: nextBooked.trip.title,
          date: formatShortDate(nextBooked.trip.startsAt, locale, timezone),
          time: formatTime(nextBooked.trip.startsAt, locale, timezone),
        })
      : null,
  };
}
