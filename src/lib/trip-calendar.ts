type CalendarTrip = {
  title: string;
  description?: string | null;
  startsAt: Date;
  endsAt: Date;
  location?: string | null;
  url: string;
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

/** A portable calendar event: UTC instants avoid silently shifting a dive across time zones. */
export function tripCalendarFile(trip: CalendarTrip): string {
  const description = [trip.description?.trim(), `Trip details: ${trip.url}`]
    .filter(Boolean)
    .join("\n\n");
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//DiveDay//Trip calendar//EN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    "BEGIN:VEVENT",
    `UID:${escapeIcs(trip.url)}@diveday`,
    `DTSTART:${icsDate(trip.startsAt)}`,
    `DTEND:${icsDate(trip.endsAt)}`,
    `SUMMARY:${escapeIcs(trip.title)}`,
    `DESCRIPTION:${escapeIcs(description)}`,
    ...(trip.location ? [`LOCATION:${escapeIcs(trip.location)}`] : []),
    `URL:${escapeIcs(trip.url)}`,
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  return `${lines.join("\r\n")}\r\n`;
}
