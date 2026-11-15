import type { ComputerCsvMapping } from "./options";
import { computerTime } from "./time";
import { finite, type ParsedComputerDive, refuse } from "./types";

function mappedTime(row: Record<string, string>, mapping: ComputerCsvMapping) {
  const rawDate = row[mapping.columns.date]?.trim() ?? "";
  const pattern =
    mapping.dateFormat === "iso"
      ? /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?)?$/
      : /^(\d{2})\/(\d{2})\/(\d{4})(?: (\d{2}:\d{2}(?::\d{2})?)(Z|[+-]\d{2}:\d{2})?)?$/;
  const match = pattern.exec(rawDate);
  if (!match) refuse("invalid_value");
  const [, a, b, c, embeddedTime, embeddedOffset] = match;
  const localDate =
    mapping.dateFormat === "iso"
      ? `${a}-${b}-${c}`
      : mapping.dateFormat === "dmy"
        ? `${c}-${b}-${a}`
        : `${c}-${a}-${b}`;
  const separateTime = mapping.columns.time ? row[mapping.columns.time]?.trim() : undefined;
  if (embeddedTime && separateTime) refuse("invalid_value");
  const time = separateTime || embeddedTime;
  const offset = mapping.columns.utcOffset ? row[mapping.columns.utcOffset]?.trim() : undefined;
  if (offset !== undefined && !/^(?:unknown|Z|[+-]\d{2}:\d{2})$/.test(offset))
    refuse("invalid_value");
  // Validate offset ranges and conflicting evidence even on date-only rows.
  const suppliedOffset = offset === undefined || offset === "unknown" ? undefined : offset;
  const offsetValue = suppliedOffset
    ? computerTime(`${localDate}T00:00:00${suppliedOffset}`).offsetMinutes
    : null;
  if (embeddedOffset && offset !== undefined) {
    const embeddedValue = computerTime(`${localDate}T00:00:00${embeddedOffset}`).offsetMinutes;
    if (embeddedValue !== offsetValue) refuse("invalid_value");
  }
  if (!time) {
    // Midnight is used only to validate the calendar date and is never returned as evidence.
    computerTime(`${localDate}T00:00:00`);
    return { localDate, localStart: null, startInstant: null, offsetMinutes: null };
  }
  if (!/^\d{2}:\d{2}(?::\d{2})?$/.test(time)) refuse("invalid_value");
  return computerTime(`${localDate}T${time}${embeddedOffset ?? suppliedOffset ?? ""}`);
}

export function parseMappedCsvRows(
  rows: Record<string, string>[],
  fields: string[],
  mapping: ComputerCsvMapping,
): ParsedComputerDive[] {
  if (Object.values(mapping.columns).some((column) => !fields.includes(column)))
    refuse("invalid_csv");
  return rows.map((row) => {
    const time = mappedTime(row, mapping);
    const duration = mapping.columns.duration
      ? finite(
          row[mapping.columns.duration],
          0,
          mapping.durationUnit === "minutes" ? 10080 : 604800,
        )
      : null;
    const depth = mapping.columns.maxDepth
      ? finite(row[mapping.columns.maxDepth], 0, mapping.depthUnit === "ft" ? 2000 / 0.3048 : 2000)
      : null;
    return {
      sourceFormat: "csv",
      sourceId: mapping.columns.sourceId ? row[mapping.columns.sourceId]?.trim() || null : null,
      device: mapping.columns.device ? row[mapping.columns.device]?.trim() || null : null,
      ...time,
      durationSeconds:
        duration === null ? null : duration * (mapping.durationUnit === "minutes" ? 60 : 1),
      maxDepthMeters: depth === null ? null : depth * (mapping.depthUnit === "ft" ? 0.3048 : 1),
      samples: [],
      gases: [],
      tanks: [],
      warnings: [
        ...(time.offsetMinutes === null ? ["timezone_unknown"] : []),
        ...(time.localStart === null ? ["date_only"] : []),
      ],
      sourceUnits: {
        depth: mapping.columns.maxDepth ? mapping.depthUnit : null,
        temperature: null,
        pressure: null,
      },
      csvMapping: mapping,
    };
  });
}
