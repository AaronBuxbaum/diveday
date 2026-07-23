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
  "contacts.csv":
    "One flat row per person, shaped for another system's import wizard: names pre-split, the best certification card (current before expired, verified before pending, expiry included so the destination can enforce it), enriched-air status, and rental sizes. The normalized files stay authoritative — this file exists so leaving never means hand-merging CSVs. Certifications imported from it should land unverified in the destination until its staff re-check the card.",
  "people.csv": "Everyone the shop knows — divers and staff — with their roles.",
  "certifications.csv": "Certification-ladder cards with their verification status.",
  "specialty_certifications.csv":
    "Specialty cards (deep, wreck, night, drysuit) with verification status.",
  "nitrox_certifications.csv": "Enriched-air (EANx) cards with verification status.",
  "trips.csv":
    "Every trip ever scheduled, including cancelled ones, with sites and predicted conditions.",
  "trip_series.csv":
    "Recurring-trip templates; every materialized instance is its own row in trips.csv carrying series_id.",
  "trip_dives.csv": "The ordered dives within each trip, with their sites.",
  "trip_requirements.csv":
    "Each trip's own boarding gates: waiver, minimum level, specialties, nitrox, payment. Not the whole gate — the effective requirement also composes in each visited dive site's gate (stricter minimum level wins, specialties union, nitrox if either says so); apply that composition in any system enforcing boarding from this export.",
  "trip_assignments.csv": "Which staff crewed each trip.",
  "bookings.csv":
    "Every booking with its trip, diver, and payment state. wants_nitrox is a request, never a fill authorization — honor it only against a verified enriched-air card, checked at fill time.",
  "waitlist_entries.csv":
    "Divers in line for full trips. A wait-list entry never consumed a seat and never appears on a manifest.",
  "roll_call_events.csv":
    "The boarding and roll-call ledger — every head-count event, with who recorded it. Read it append-only and in checkpoint order (departure, then after each dive): within one checkpoint the newest event per booking wins, and a 'cleared' event erases that checkpoint's result. Then carry forward: an explicit 'not_boarded' fills every later checkpoint that has no explicit result of its own until an explicit 'boarded' breaks the chain — off the boat stays off the boat; a checkpoint with no result and nothing carried means awaiting. Never count 'boarded' rows naively; corrections would inflate the head count.",
  "waiver_templates.csv":
    "Every waiver template version, full text included — signed records reference these.",
  "waiver_records.csv":
    "Issued and signed waiver evidence; the signed text is the referenced template version. Only status 'completed' satisfies the waiver gate, and only while current (within a year of signing, against the shop's current release). 'medical_review' means a physician's sign-off is still outstanding — that diver is blocked from boarding, not merely flagged, even though the signature fields are filled in.",
  "rental_fit.csv": "Each diver's rental kit and sizes.",
  "orders.csv":
    "Shop-issued orders and invoices with their Stripe references — reconcilable against the shop's own Stripe account, which stays the shop's.",
  "order_line_items.csv": "The lines on each order (trip fees, courses, rentals, nitrox, retail).",
  "dive_sites.csv":
    "The shop's dive-site briefing library, archived sites included. Image links stay readable while the DiveDay account is active.",
  "dive_site_creatures.csv": "The field-guide creatures attached to each dive-site briefing.",
  "dive_site_moments.csv":
    "Staff-moderated diver moments attached to dive sites, published and unpublished.",
  "courses.csv": "The course catalog with public-page content, hidden courses included.",
} as const;

export type ExportFileName = keyof typeof EXPORT_FILE_NOTES;

/**
 * Would this diver-authored string execute as a formula in Excel/LibreOffice?
 * `=`, `@`, tab, and CR always count. A leading `+` or `-` counts only when
 * followed by anything beyond digits and phone punctuation: `+1 305 555 0100`
 * is an E.164 phone number a destination system must receive intact — the one
 * thing a purely numeric cell can do in a spreadsheet is display as a number,
 * never reach a DDE/command payload, which needs letters or pipes.
 */
function opensAsFormula(text: string): boolean {
  if (/^[=@\t\r]/.test(text)) return true;
  return /^[+-]/.test(text) && !/^[+-][\d\s()./-]*$/.test(text);
}

/** Serialize one cell: empty for null/undefined, ISO for dates, RFC-4180 quoting. */
export function csvCell(value: CsvValue): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return value.toISOString();
  let text = typeof value === "string" ? value : String(value);
  // Neutralize spreadsheet formulas (CSV injection): a *string* cell that
  // opens as a formula executes when the export opens in Excel or LibreOffice
  // — RFC-4180 quoting does not prevent it — and names on a public booking
  // are diver-controlled. The apostrophe is the spreadsheet "treat as text"
  // marker; the bundle README documents it. Numbers and phone-shaped strings
  // stay untouched so amounts and E.164 numbers import intact.
  if (typeof value === "string" && opensAsFormula(text)) text = `'${text}`;
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
  "Notification delivery logs — operational plumbing, not shop records.",
  "Stripe account linkage and checkout-session attempts — every money outcome is in bookings.csv and orders.csv, and the Stripe account itself already belongs to the shop.",
  "DiveDay's shared dive-site catalog templates (the shop's own copies export in dive_sites.csv).",
  "Image binaries of any kind — certification card photos, dive-site imagery, and course media are carried as stored references in their CSVs, never as files; those references stay readable while the shop's DiveDay account is active, so save copies of anything you need before closing an account.",
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
    `Text that would open as a spreadsheet formula (leading =, @, or a +/-`,
    `followed by anything beyond digits and phone punctuation) is prefixed`,
    `with an apostrophe so it always reads as text; strip it when importing`,
    `programmatically. Phone numbers like +1 305 555 0100 are never altered.`,
    ``,
    `Files:`,
    ...input.tables.map(
      (table) =>
        `- ${table.file} (${table.rows.length} ${table.rows.length === 1 ? "row" : "rows"}): ${table.note}`,
    ),
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
