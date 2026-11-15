import { safeComputerCsvColumn as safeCsvColumn } from "@/lib/computer-csv-columns";

export { safeComputerCsvColumn as safeCsvColumn } from "@/lib/computer-csv-columns";

import { refuse } from "./types";

/** Explicit staff choices for a generic CSV; this is not a vendor export mapping. */
export type ComputerCsvMapping = {
  columns: {
    date: string;
    time?: string;
    duration?: string;
    maxDepth?: string;
    utcOffset?: string;
    device?: string;
    sourceId?: string;
  };
  dateFormat: "iso" | "dmy" | "mdy";
  durationUnit: "seconds" | "minutes";
  depthUnit: "m" | "ft";
};
export type ComputerParseOptions = { csvMapping?: ComputerCsvMapping };

const columnNames = ["date", "time", "duration", "maxDepth", "utcOffset", "device", "sourceId"];

function object(value: unknown): value is Record<string, unknown> {
  return (
    value !== null &&
    typeof value === "object" &&
    !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value))
  );
}
function keys(value: Record<string, unknown>, allowed: string[]) {
  if (Object.keys(value).some((key) => !allowed.includes(key))) refuse("invalid_options");
}
/** Validate even when the selected file is not CSV; never trust client-supplied options. */
export function validateComputerParseOptions(raw: unknown): ComputerParseOptions {
  if (raw === undefined) return {};
  if (!object(raw)) refuse("invalid_options");
  keys(raw, ["csvMapping"]);
  if (!Object.hasOwn(raw, "csvMapping")) return {};
  const mapping = raw.csvMapping;
  if (!object(mapping)) refuse("invalid_options");
  keys(mapping, ["columns", "dateFormat", "durationUnit", "depthUnit"]);
  if (
    typeof mapping.dateFormat !== "string" ||
    !["iso", "dmy", "mdy"].includes(mapping.dateFormat) ||
    typeof mapping.durationUnit !== "string" ||
    !["seconds", "minutes"].includes(mapping.durationUnit) ||
    typeof mapping.depthUnit !== "string" ||
    !["m", "ft"].includes(mapping.depthUnit) ||
    !object(mapping.columns)
  )
    refuse("invalid_options");
  keys(mapping.columns, columnNames);
  if (!Object.hasOwn(mapping.columns, "date") || !safeCsvColumn(mapping.columns.date))
    refuse("invalid_options");
  const columns: Record<string, string> = {};
  for (const name of columnNames) {
    if (!Object.hasOwn(mapping.columns, name)) continue;
    const value = mapping.columns[name];
    if (!safeCsvColumn(value)) refuse("invalid_options");
    columns[name] = value;
  }
  if (new Set(Object.values(columns)).size !== Object.keys(columns).length)
    refuse("invalid_options");
  return {
    csvMapping: {
      columns: columns as ComputerCsvMapping["columns"],
      dateFormat: mapping.dateFormat as ComputerCsvMapping["dateFormat"],
      durationUnit: mapping.durationUnit as ComputerCsvMapping["durationUnit"],
      depthUnit: mapping.depthUnit as ComputerCsvMapping["depthUnit"],
    },
  };
}
