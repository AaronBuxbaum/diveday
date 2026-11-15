import Papa from "papaparse";
import { computerTime } from "./time";
import { finite, type ParsedComputerDive, refuse } from "./types";
/** Units are required column names. This template is not a vendor export mapping. */
export const COMPUTER_CSV_TEMPLATE =
  "local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2026-01-01T12:00:00,unknown,Computer,1,1800,20\n";
const baseColumns = ["local_start", "utc_offset", "device", "source_id", "duration_seconds"];
export function parseCsv(text: string): ParsedComputerDive[] {
  const result = Papa.parse<Record<string, string>>(text, {
    header: true,
    skipEmptyLines: "greedy",
    dynamicTyping: false,
  });
  if (result.errors.length || !result.meta.fields) refuse("invalid_csv");
  const fields = result.meta.fields;
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
  )
    refuse("invalid_csv");
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
