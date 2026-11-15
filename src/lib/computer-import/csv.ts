import Papa from "papaparse";
import { parseMappedCsvRows } from "./csv-mapping";
import { type ComputerCsvMapping, safeCsvColumn } from "./options";
import { computerTime } from "./time";
import { finite, COMPUTER_IMPORT_LIMITS as LIMIT, type ParsedComputerDive, refuse } from "./types";
/** Units are required column names. This template is not a vendor export mapping. */
export const COMPUTER_CSV_TEMPLATE =
  "local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2026-01-01T12:00:00,unknown,Computer,1,1800,20\n";
const baseColumns = ["local_start", "utc_offset", "device", "source_id", "duration_seconds"];
function csvColumns(text: string): string[] {
  // The first record must finish inside this bound, including quoting overhead.
  const prefix = text.slice(0, 32768);
  const result = Papa.parse<string[]>(prefix, { delimiter: ",", preview: 1 });
  const fields = result.data[0];
  if (
    result.errors.length ||
    !fields ||
    fields.length > 64 ||
    fields.some((field) => !safeCsvColumn(field)) ||
    new Set(fields.map((field) => field.normalize("NFKC").trim().toLowerCase())).size !==
      fields.length ||
    (text.length > prefix.length && result.meta.cursor >= prefix.length)
  )
    refuse("invalid_csv");
  return fields;
}
/** Browser-safe header inspection only; no dates, units or mapping are inferred. */
export function inspectCsvColumns(bytes: Uint8Array): string[] {
  if (bytes.byteLength > LIMIT.fileBytes) refuse("file_too_large");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return refuse("invalid_encoding");
  }
  return csvColumns(text);
}
export function parseCsv(text: string, mapping?: ComputerCsvMapping): ParsedComputerDive[] {
  const fields = csvColumns(text);
  const result = Papa.parse<Record<string, string>>(text, {
    delimiter: ",",
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (result.errors.length || !result.meta.fields) refuse("invalid_csv");
  if (result.data.length > LIMIT.dives) refuse("limit_exceeded");
  if (
    result.data.some((row) =>
      Object.values(row).some((s) => typeof s !== "string" || s.length > LIMIT.textLength),
    )
  )
    refuse("invalid_csv");
  const depthField = fields.includes("max_depth_m")
    ? "max_depth_m"
    : fields.includes("max_depth_ft")
      ? "max_depth_ft"
      : null;
  if (
    !depthField ||
    baseColumns.some((c) => !fields.includes(c)) ||
    fields.length !== baseColumns.length + 1 ||
    new Set(fields).size !== fields.length
  ) {
    if (mapping) return parseMappedCsvRows(result.data, fields, mapping);
    refuse("invalid_csv");
  }
  return result.data.map((row) => {
    if (Object.values(row).some((s) => typeof s !== "string" || s.length > 4096))
      refuse("invalid_csv");
    const offset = row.utc_offset?.trim();
    if (!offset || (offset !== "unknown" && !/^(?:Z|[+-]\d{2}:\d{2})$/.test(offset)))
      refuse("invalid_value");
    const time = computerTime(`${row.local_start?.trim()}${offset === "unknown" ? "" : offset}`);
    const depth = finite(row[depthField], 0, depthField === "max_depth_ft" ? 6500 : 2000);
    return {
      sourceFormat: "csv",
      sourceId: row.source_id?.trim() || null,
      device: row.device?.trim() || null,
      ...time,
      durationSeconds: finite(row.duration_seconds, 0, 604800),
      maxDepthMeters: depth === null ? null : depth * (depthField === "max_depth_ft" ? 0.3048 : 1),
      samples: [],
      gases: [],
      tanks: [],
      warnings: time.offsetMinutes === null ? ["timezone_unknown"] : [],
      sourceUnits: {
        depth: depthField === "max_depth_ft" ? "ft" : "m",
        temperature: null,
        pressure: null,
      },
    };
  });
}
