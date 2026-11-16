import { buildCsv } from "./csv";
import {
  MAX_IMPORT_BYTES,
  MAX_IMPORT_CELL_LENGTH,
  MAX_IMPORT_COLUMNS,
  MAX_IMPORT_ROWS,
  parseCsv,
  widestRow,
} from "./import";

/** Positional mapping keeps repeated source headers distinguishable. No column may disappear. */
export function mapImportColumns(csv: string, mapping: unknown, allowed: readonly string[]) {
  if (new TextEncoder().encode(csv).length > MAX_IMPORT_BYTES)
    return { error: "file_too_large" } as const;
  const grid = parseCsv(csv).filter((row) => row.some((cell) => cell.trim()));
  if (!grid.length) return { error: "file_empty" } as const;
  if (widestRow(grid) > MAX_IMPORT_COLUMNS) return { error: "too_many_columns" } as const;
  if (grid.length - 1 > MAX_IMPORT_ROWS) return { error: "too_many_rows" } as const;
  if (grid.some((row) => row.some((cell) => cell.length > MAX_IMPORT_CELL_LENGTH)))
    return { error: "cell_too_long" } as const;
  if (
    !Array.isArray(mapping) ||
    mapping.length !== grid[0].length ||
    mapping.some((field) => typeof field !== "string" || !allowed.includes(field)) ||
    new Set(mapping).size !== mapping.length ||
    grid.some((row) => row.length > mapping.length)
  )
    return { error: "invalid_mapping" } as const;
  const headers = mapping as string[];
  // This is an internal transport, not a spreadsheet download. Preserve exact
  // values; only the correction download below neutralizes formulas.
  const cell = (value: string) =>
    /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
  return {
    csv: [headers, ...grid.slice(1).map((row) => headers.map((_, index) => row[index] ?? ""))]
      .map((row) => row.map(cell).join(","))
      .join("\r\n"),
    grid,
    headers,
  } as const;
}

export function parseImportColumnMapping(value: FormDataEntryValue | null): unknown {
  if (typeof value !== "string" || value.length > 16_384) return null;
  try {
    return JSON.parse(value);
  } catch {
    return null;
  }
}

/** Download only: spreadsheet-safe, source row numbers and explicit diagnostics. */
export function importCorrectionCsv(
  grid: string[][],
  problems: { rowNumber: number; issues: string[] }[],
) {
  return buildCsv(
    ["source_row", "issues", ...(grid[0] ?? [])],
    problems.map((problem) => [
      problem.rowNumber,
      problem.issues.join("; "),
      ...(grid[problem.rowNumber - 1] ?? [])
        .concat(
          Array(
            Math.max(0, (grid[0]?.length ?? 0) - (grid[problem.rowNumber - 1]?.length ?? 0)),
          ).fill(""),
        )
        .slice(0, grid[0]?.length ?? 0),
    ]),
  );
}
