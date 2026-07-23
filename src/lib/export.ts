/**
 * Full-shop export bundle: RFC-4180 CSV serialization and ZIP assembly
 * (ADR 20260722-full-shop-export). Framework-free — the data arrives as plain
 * tables from src/db/export.ts and leaves as bytes the route can stream. The
 * CSV column sets written here are the documented contract the planned
 * importer, scheduled backups, and read API reuse; change them deliberately.
 */

import { strToU8, zipSync } from "fflate";

/** Everything a CSV cell can hold. Dates serialize as ISO 8601 UTC. */
export type CsvValue = string | number | boolean | Date | null | undefined;

export type ExportTable = {
  /** File name inside the bundle, e.g. "people.csv". */
  file: string;
  header: string[];
  rows: CsvValue[][];
  /** One line for the bundle README describing what the file holds. */
  note: string;
};

export type ExportFile = { name: string; content: string };

/**
 * The bundle's file list and README notes, in bundle order. One definition so
 * the loader, the counts query behind the settings page, and the README can
 * never drift apart (a sync test enforces it).
 */
export const EXPORT_FILE_NOTES = {
  "shop.csv": "The shop profile, packing checklist, rental catalog, and rental prices.",
  "people.csv": "Everyone the shop knows — divers and staff — with their roles.",
  "certifications.csv": "Certification-ladder cards with their verification status.",
  "specialty_certifications.csv":
    "Specialty cards (deep, wreck, night, drysuit) with verification status.",
  "nitrox_certifications.csv": "Enriched-air (EANx) cards with verification status.",
  "trips.csv":
    "Every trip ever scheduled, including cancelled ones, with sites and predicted conditions.",
  "trip_dives.csv": "The ordered dives within each trip, with their sites.",
  "trip_requirements.csv":
    "Each trip's boarding gates: waiver, minimum level, specialties, nitrox, payment.",
  "trip_assignments.csv": "Which staff crewed each trip.",
  "bookings.csv": "Every booking with its trip, diver, and payment state.",
  "roll_call_events.csv":
    "The boarding and roll-call ledger — every head-count event, with who recorded it.",
  "waiver_templates.csv":
    "Every waiver template version, full text included — signed records reference these.",
  "waiver_records.csv":
    "Issued and signed waiver evidence; the signed text is the referenced template version.",
  "rental_fit.csv": "Each diver's rental kit and sizes.",
} as const;

export type ExportFileName = keyof typeof EXPORT_FILE_NOTES;

/** Serialize one cell: empty for null/undefined, ISO for dates, RFC-4180 quoting. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  let text = typeof value === "string" ? value : String(value);
  // Neutralize spreadsheet formulas (CSV injection): a *string* cell starting
  // with =, +, -, @, tab, or CR executes when the export opens in Excel or
  // LibreOffice — RFC-4180 quoting does not prevent it — and names on a public
  // booking are diver-controlled. The apostrophe is the spreadsheet "treat as
  // text" marker; the bundle README documents it. Numbers stay untouched, so
  // negative amounts never gain a prefix.
  if (typeof value === "string" && /^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  // Quote only when needed: embedded quote, comma, or line break.
  if (/[",\r\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

/** Serialize a table to RFC-4180 CSV (CRLF line endings, header row first). */
export function buildCsv(header: string[], rows: CsvValue[][]): string {
  for (const row of rows) {
    if (row.length !== header.length) {
      throw new Error(`csv row has ${row.length} cells; header has ${header.length}`);
    }
  }
  const lines = [header, ...rows].map((row) => row.map(csvCell).join(","));
  return `${lines.join("\r\n")}\r\n`;
}

/** "2026-07-22" in the shop's own timezone — the date a human would say it is. */
export function exportDateStamp(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    timeZone: timezone,
  }).format(now);
}

export function exportFileName(shopSlug: string, now: Date, timezone: string): string {
  return `diveday-export-${shopSlug}-${exportDateStamp(now, timezone)}.zip`;
}

/**
 * Record families deliberately absent from the bundle, stated in the README —
 * an export that is quiet about its gaps is how migrations lose data.
 */
const NOT_INCLUDED = [
  "Offline manifest snapshots (device-side copies of the live records exported here).",
  "Wait-list entries, notification delivery logs, and Stripe checkout/order records.",
  "The dive-site library and course catalog content (trips and dives carry their site names and ids).",
  "Certification card images (the CSVs carry each card's stored image reference).",
  "Login accounts and password hashes — credentials are never exported.",
];

export type ExportBundleInput = {
  shopName: string;
  shopSlug: string;
  timezone: string;
  tables: ExportTable[];
};

/** Assemble the bundle: one CSV per table plus a README.txt manifest. */
export function buildExportBundle(input: ExportBundleInput, now: Date): ExportFile[] {
  const files = input.tables.map((table) => ({
    name: table.file,
    content: buildCsv(table.header, table.rows),
  }));

  const readme = [
    `DiveDay full-shop export`,
    `Shop: ${input.shopName} (${input.shopSlug})`,
    `Exported at: ${now.toISOString()} (dates below are in ${input.timezone})`,
    ``,
    `Every file is UTF-8 CSV (RFC 4180). Timestamps are ISO 8601 in UTC.`,
    `Money columns are minor units (cents). Rows with a deleted_at value are`,
    `soft-archived history — kept so nothing is lost in a migration.`,
    `Text that would open as a spreadsheet formula (leading =, +, -, or @) is`,
    `prefixed with an apostrophe so it always reads as text.`,
    ``,
    `Files:`,
    ...input.tables.map((table) => `- ${table.file} (${table.rows.length} rows): ${table.note}`),
    ``,
    `Not included in this bundle:`,
    ...NOT_INCLUDED.map((line) => `- ${line}`),
    ``,
    `Your data is yours. This export is available to every shop on every plan.`,
  ].join("\n");

  return [{ name: "README.txt", content: `${readme}\n` }, ...files];
}

/** Zip the bundle (fflate deflate); content is small enough for sync work. */
export function zipExportBundle(files: ExportFile[]): Uint8Array {
  const entries: Record<string, Uint8Array> = {};
  for (const file of files) entries[file.name] = strToU8(file.content);
  return zipSync(entries);
}
