/**
 * iCalendar (RFC 5545) primitives, shared by the diver's one-off `.ics`
 * download and the staff subscription feed in `src/features/calendar-sync`.
 * Framework-free and pure so both callers can be tested without a request.
 */

type CalendarTrip = {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  url: string;
};

/** One event in a multi-event feed. `uid` must be stable across fetches. */
export type CalendarEvent = CalendarTrip & {
  /**
   * The event's identity to the subscribing calendar. A calendar client
   * updates an event when a later fetch repeats its UID and replaces it when
   * the UID changes — so this must be derived from the trip's identity, never
   * from its contents, or every edit orphans the diver's old entry and every
   * captain gets a duplicate.
   */
  uid: string;
  /**
   * RFC 5545 `SEQUENCE`: how many times this event has been revised. It must
   * rise monotonically per UID and only for a **material** change, which is
   * why it comes from `trips.revision` rather than from anything derived here
   * (issue #1165). Required rather than optional: there are two callers, both
   * have the number, and a default would be a fabricated revision.
   */
  sequence: number;
};

function escapeIcs(value: string): string {
  return value
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function icsDate(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function eventLines(event: CalendarEvent, stamp: Date): string[] {
  const description = [event.description?.trim(), `Trip details: ${event.url}`]
    .filter(Boolean)
    .join("\n\n");
  return [
    "BEGIN:VEVENT",
    `UID:${escapeIcs(event.uid)}`,
    // DTSTAMP is required by RFC 5545 and is when this *copy* of the event was
    // produced, which is not the same fact as when the trip was created.
    `DTSTAMP:${icsDate(stamp)}`,
    `DTSTART:${icsDate(event.startsAt)}`,
    `DTEND:${icsDate(event.endsAt)}`,
    `SUMMARY:${escapeIcs(event.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    ...(event.location ? [`LOCATION:${escapeIcs(event.location)}`] : []),
    `URL:${escapeIcs(event.url)}`,
    // Written even at zero, never omitted: an absent SEQUENCE and a
    // `SEQUENCE:0` are different facts to a client, and a first revision that
    // appeared out of nothing would be the ambiguous one.
    `SEQUENCE:${event.sequence}`,
    "END:VEVENT",
  ];
}

/**
 * A calendar document holding any number of events. UTC instants avoid
 * silently shifting a dive across time zones.
 *
 * `name` becomes the calendar's display name in Google/Apple/Outlook when the
 * document is subscribed to rather than imported — without it a subscribed
 * feed shows up as its raw URL in the client's sidebar.
 */
export function calendarDocument(input: {
  events: readonly CalendarEvent[];
  stamp: Date;
  name?: string;
  refreshMinutes?: number;
}): string {
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DiveDay//Trip calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    ...(input.name
      ? [`X-WR-CALNAME:${escapeIcs(input.name)}`, `NAME:${escapeIcs(input.name)}`]
      : []),
    // Both spellings: Google and Outlook read the X- form, Apple reads
    // REFRESH-INTERVAL. Neither is binding — a client polls when it likes —
    // so this is a hint, not a guarantee about feed freshness.
    ...(input.refreshMinutes
      ? [
          `REFRESH-INTERVAL;VALUE=DURATION:PT${input.refreshMinutes}M`,
          `X-PUBLISHED-TTL:PT${input.refreshMinutes}M`,
        ]
      : []),
    ...input.events.flatMap((event) => eventLines(event, input.stamp)),
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}

/**
 * A portable single-event calendar file: the diver's "add to my calendar"
 * download.
 *
 * `stamp` is separable from `startsAt` because the event a diver puts in their
 * calendar **begins at the dock call**, not at the moment the lines come off
 * (issue #1165) — while DTSTAMP still wants an instant tied to the trip
 * itself. Defaulting it to `startsAt` keeps every existing caller byte-for-byte
 * identical.
 *
 * `revision` is the trip's own counter, published as `SEQUENCE` so a diver who
 * downloads the file again after the departure moved gets an update to the
 * entry they already hold rather than a second one beside it.
 */
export function tripCalendarFile(trip: CalendarTrip & { stamp?: Date; revision: number }): string {
  return calendarDocument({
    events: [{ ...trip, uid: `${trip.url}@diveday`, sequence: trip.revision }],
    // A one-off download is produced now and never re-fetched, so an instant
    // of the trip's own is a stable stamp — and one that keeps the file
    // byte-identical across renders, which the visual and e2e fleets depend on.
    stamp: trip.stamp ?? trip.startsAt,
  });
}
