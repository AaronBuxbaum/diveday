import { z } from "zod";
import { buildCsv } from "./csv";
import {
  type ImportField,
  MANUAL_MAPPABLE_FIELDS,
  MAX_IMPORT_BYTES,
  type ManualImportMapping,
  type PreparedImport,
  parseCsv,
  unclaimedImportHeaders,
} from "./import";

const input = z.record(
  z.string().trim().min(1).max(200),
  z.enum(MANUAL_MAPPABLE_FIELDS as [ImportField, ...ImportField[]]),
);

/** A malformed posted map must fail closed rather than silently import another preview. */
export function parseManualImportMapping(raw: string): ManualImportMapping | null {
  if (raw.length > 20_000) return null;
  try {
    const parsed = input.safeParse(JSON.parse(raw));
    return parsed.success ? parsed.data : null;
  } catch {
    return null;
  }
}

/** Local mapping never sends a file to a provider, or offers sensitive source columns. */
export function manualImportColumns(csv: string): string[] {
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES) return [];
  const headers = parseCsv(csv).find((row) => row.some((cell) => cell.trim()));
  return headers ? [...new Set(unclaimedImportHeaders(headers))] : [];
}

/** Correct only the rows needing attention; every exported cell uses shared formula protection. */
export function importRecoveryCsv(
  csv: string,
  prepared: PreparedImport,
  conflictRows: number[] = [],
): string | null {
  const conflicts = new Set(conflictRows);
  const rows = prepared.rows.filter(
    (row) =>
      conflicts.has(row.rowNumber) ||
      row.action === "skip" ||
      row.issues.some((issue) => issue.level !== "info"),
  );
  if (rows.length === 0) return null;
  const grid = parseCsv(csv).filter((row) => row.some((cell) => cell.trim() !== ""));
  const headers = grid[0];
  if (!headers) return null;
  return buildCsv(
    [...headers, "import_row", "import_issues"],
    rows.map((row) => [
      ...headers.map((_, index) => grid[row.rowNumber]?.[index] ?? ""),
      row.rowNumber,
      [
        ...row.issues.map((issue) => issue.code),
        ...(conflicts.has(row.rowNumber) ? ["manual_identity_conflict"] : []),
      ].join("; "),
    ]),
  );
}
