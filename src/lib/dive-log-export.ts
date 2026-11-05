import { calendarDateInTimezone } from "./calendar-date";
import { csvCell } from "./export";
import { utcToWallTime } from "./zoned";

/**
 * **The diver's log entry as a file** (loop 5, row 13; glossary "Log entry
 * file"): the recap's dive record, handed over as a CSV row or a UDDF dive so
 * the diver can carry it into the logbook app they already use.
 *
 * It holds what the shop wrote down and nothing else, the same floor
 * `DiveRecord` prints: the day, the shop, the trip, the sites, the conditions
 * the crew recorded. DiveDay records nothing about dives performed, so there
 * is no depth, bottom time or gas in it, and none is invented; the diver adds
 * those in their own app. The entry is one departure, one row, one `dive`.
 */
export type DiveLogEntry = {
  shopName: string;
  tripTitle: string;
  startsAt: Date;
  /** The shop's zone; the date and the start time are its wall clock. */
  timeZone: string;
  siteNames: string[];
  waterTemperatureC: number | null;
  visibilityMeters: number | null;
  surfaceConditions: string | null;
};

export const DIVE_LOG_FORMATS = ["csv", "uddf"] as const;
export type DiveLogFormat = (typeof DIVE_LOG_FORMATS)[number];

export function diveLogFormat(raw: string | null): DiveLogFormat | null {
  return (DIVE_LOG_FORMATS as readonly string[]).includes(raw ?? "")
    ? (raw as DiveLogFormat)
    : null;
}

function wallClock(entry: DiveLogEntry) {
  const wall = utcToWallTime(entry.startsAt, entry.timeZone);
  const pad = (value: number) => String(value).padStart(2, "0");
  return {
    date: calendarDateInTimezone(entry.startsAt, entry.timeZone),
    time: `${pad(wall.hour)}:${pad(wall.minute)}`,
  };
}

const CSV_HEADER = [
  "date",
  "start_time",
  "time_zone",
  "shop",
  "trip",
  "sites",
  "water_temperature_c",
  "visibility_m",
  "surface_conditions",
] as const;

/** One header row and one entry row, RFC 4180, with the export's formula guard on every text cell. */
export function diveLogCsv(entry: DiveLogEntry): string {
  const { date, time } = wallClock(entry);
  const row = [
    date,
    time,
    entry.timeZone,
    entry.shopName,
    entry.tripTitle,
    entry.siteNames.join("; "),
    entry.waterTemperatureC,
    entry.visibilityMeters,
    entry.surfaceConditions,
  ];
  return `${CSV_HEADER.join(",")}\r\n${row.map(csvCell).join(",")}\r\n`;
}

function xml(text: string): string {
  return (
    text
      // Control characters other than tab and line breaks are not legal XML.
      .replace(/[^\P{Cc}\t\n\r]/gu, "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;")
  );
}

/**
 * A minimal UDDF 3.2 document: one dive site per recorded site and one `dive`
 * linking them, dated in the shop's wall clock. The conditions travel as
 * notes, since the crew's reading is a day's condition and not a sample.
 */
export function diveLogUddf(entry: DiveLogEntry, generatedAt: Date): string {
  const { date, time } = wallClock(entry);
  const notes = [
    entry.waterTemperatureC !== null ? `Water temperature: ${entry.waterTemperatureC} C` : null,
    entry.visibilityMeters !== null ? `Visibility: ${entry.visibilityMeters} m` : null,
    entry.surfaceConditions ? `Surface: ${entry.surfaceConditions}` : null,
    `${entry.tripTitle}, ${entry.shopName}`,
  ].filter((line): line is string => line !== null);
  const sites = entry.siteNames.map((name, index) => ({ id: `site${index + 1}`, name }));
  return [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<uddf version="3.2.3" xmlns="http://www.streit.cc/uddf/3.2/">`,
    `  <generator>`,
    `    <name>DiveDay</name>`,
    `    <type>logbook</type>`,
    `    <datetime>${generatedAt.toISOString().slice(0, 19)}</datetime>`,
    `  </generator>`,
    ...(sites.length > 0
      ? [
          `  <divesite>`,
          ...sites.map((site) => `    <site id="${site.id}"><name>${xml(site.name)}</name></site>`),
          `  </divesite>`,
        ]
      : []),
    `  <profiledata>`,
    `    <repetitiongroup id="day1">`,
    `      <dive id="dive1">`,
    `        <informationbeforedive>`,
    `          <datetime>${date}T${time}:00</datetime>`,
    ...sites.map((site) => `          <link ref="${site.id}"/>`),
    `        </informationbeforedive>`,
    `        <notes>`,
    ...notes.map((line) => `          <para>${xml(line)}</para>`),
    `        </notes>`,
    `      </dive>`,
    `    </repetitiongroup>`,
    `  </profiledata>`,
    `</uddf>`,
    ``,
  ].join("\n");
}

/** The download's file name: the shop's trip and its day, safe in any file system. */
export function diveLogFileName(entry: DiveLogEntry, format: DiveLogFormat): string {
  const { date } = wallClock(entry);
  const slug = entry.tripTitle
    .normalize("NFKD")
    .replace(/[^\p{L}\p{N}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40);
  return `${slug || "dive"}-${date}.${format}`;
}

/** The same name in plain ASCII, for the `filename=` fallback beside `filename*=`. */
export function diveLogAsciiFileName(entry: DiveLogEntry, format: DiveLogFormat): string {
  const { date } = wallClock(entry);
  const slug = entry.tripTitle
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .toLowerCase()
    .slice(0, 40)
    .replace(/-+$/g, "");
  return `${slug || "dive"}-${date}.${format}`;
}

/** `Content-Disposition` for the download: an ASCII fallback plus the real name (RFC 6266 / 8187). */
export function diveLogDisposition(entry: DiveLogEntry, format: DiveLogFormat): string {
  const encoded = encodeURIComponent(diveLogFileName(entry, format)).replace(
    /['()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  return `attachment; filename="${diveLogAsciiFileName(entry, format)}"; filename*=UTF-8''${encoded}`;
}
