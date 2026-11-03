import { diverTranslator } from "@/i18n/messages";
import { formatShortDate, formatTimeRangeTz } from "@/lib/format";

// i18n-exempt-file: the terminal renderer for the "your departure moved" text,
// on the same footing as `./desk-notes.ts`: nothing downstream picks words for a
// sent text, so this resolves its own words in the recipient's locale.
// `src/db/trip-rescheduled.ts` decides who is told and hands over the facts.

export type RescheduledTextInput = {
  locale: string;
  shopName: string;
  timezone: string;
  trip: { title: string; startsAt: Date; endsAt: Date };
  /** Only this diver's seat moved, to another departure. */
  seatMoved: boolean;
  /** The departure's time moved; false when only the meeting point did (#2443). */
  timeMoved: boolean;
  meetingPoint?: { label?: string | null; address?: string | null };
  readinessUrl?: string;
};

/** "Your Saturday reef trip moved to 9:00", where to meet, and the diver's own link. */
export function rescheduledText(input: RescheduledTextInput): string {
  const t = diverTranslator(input.locale);
  const facts = {
    shopName: input.shopName,
    tripTitle: input.trip.title,
    date: formatShortDate(input.trip.startsAt, input.locale, input.timezone),
    time: formatTimeRangeTz(input.trip.startsAt, input.trip.endsAt, input.locale, input.timezone),
  };
  return [
    input.seatMoved
      ? t("notifications.sms.rescheduledSeat", facts)
      : input.timeMoved
        ? t("notifications.sms.rescheduled", facts)
        : t("notifications.sms.meetingPointMoved", facts),
    input.meetingPoint
      ? t("trip.calendarMeetingPoint", {
          place: [input.meetingPoint.label, input.meetingPoint.address].filter(Boolean).join(", "),
        })
      : null,
    input.readinessUrl ? t("notifications.sms.readyLink", { url: input.readinessUrl }) : null,
  ]
    .filter(Boolean)
    .join(" ");
}
