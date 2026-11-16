/** Browser-safe RFC-4180 serialization, shared by exports and local import recovery. */
import { opensAsFormula } from "./csv-formula";

/** Everything a CSV cell can hold. Dates serialize as ISO 8601 UTC. */
export type CsvValue = string | number | boolean | Date | null | undefined;

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
