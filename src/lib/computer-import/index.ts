import { isComputerArchive, parseComputerArchive } from "./archive";
import { parseCsv } from "./csv";
import { parseFit } from "./fit";
import { type ComputerParseOptions, validateComputerParseOptions } from "./options";
import { parseSubsurface } from "./subsurface";
import { COMPUTER_IMPORT_LIMITS as LIMIT, type ParsedComputerDive, refuse } from "./types";
import { parseUddf } from "./uddf";
import { descendants, localName, parseXml } from "./xml";

export { COMPUTER_CSV_TEMPLATE, inspectCsvColumns } from "./csv";
export * from "./options";
export * from "./providers";
export * from "./types";
export function parseComputerFile(
  bytes: Uint8Array,
  rawOptions?: ComputerParseOptions,
): ParsedComputerDive[] {
  const options = validateComputerParseOptions(rawOptions);
  if (bytes.byteLength > LIMIT.fileBytes) refuse("file_too_large");
  const dives = isComputerArchive(bytes)
    ? parseComputerArchive(bytes, options, parsePlainFile)
    : parsePlainFile(bytes, options);
  return validateDives(dives);
}
function parsePlainFile(bytes: Uint8Array, options: ComputerParseOptions): ParsedComputerDive[] {
  const isFit = bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === ".FIT";
  let text = "";
  if (!isFit) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    } catch {
      return refuse("invalid_encoding");
    }
  }
  let dives: ParsedComputerDive[];
  if (isFit) dives = parseFit(bytes);
  else if (text.trimStart().startsWith("<")) {
    const root = parseXml(text.trim());
    if (localName(root) === "uddf") dives = parseUddf(root);
    else if (
      (localName(root) === "divelog" || localName(root) === "dives") &&
      (root.attrs.program?.toLowerCase() === "subsurface" ||
        descendants(root, "program").some((p) => p.attrs.name?.toLowerCase() === "subsurface"))
    )
      dives = parseSubsurface(root);
    else return refuse("unsupported_format");
  } else if (options.csvMapping) dives = parseCsv(text, options.csvMapping);
  else if (text.trimStart().startsWith("local_start,")) dives = parseCsv(text.trim());
  else return refuse("unsupported_format");
  if (dives.length === 0) refuse("no_dives");
  return dives;
}
function validateDives(dives: ParsedComputerDive[]): ParsedComputerDive[] {
  if (dives.length === 0) refuse("no_dives");
  if (dives.length > LIMIT.dives) refuse("limit_exceeded");
  let samples = 0;
  for (const dive of dives) {
    samples += dive.samples.length;
    if (dive.gases.length > 32 || dive.tanks.length > 32) refuse("limit_exceeded");
    if (
      (dive.maxDepthMeters ?? 0) > 2000 ||
      dive.samples.some(
        (sample) =>
          sample.depthMeters > 2000 ||
          (sample.temperatureC !== undefined &&
            (sample.temperatureC < -100 || sample.temperatureC > 100)),
      )
    )
      refuse("invalid_value");
    if (
      dive.tanks.some(
        (tank) =>
          (tank.volumeLiters ?? 0) > 1000 ||
          (tank.startPressureBar ?? 0) > 1000 ||
          (tank.endPressureBar ?? 0) > 1000,
      )
    )
      refuse("invalid_value");
    if (dive.samples.length > LIMIT.samplesPerDive || samples > LIMIT.samplesPerFile)
      refuse("limit_exceeded");
    for (let i = 1; i < dive.samples.length; i++)
      if ((dive.samples[i]?.seconds ?? 0) <= (dive.samples[i - 1]?.seconds ?? 0))
        refuse("invalid_value");
    if (dive.durationSeconds !== null && (dive.samples.at(-1)?.seconds ?? 0) > dive.durationSeconds)
      refuse("invalid_value");
    if (dive.samples.length === 0) dive.warnings.push("profile_absent");
    if (dive.durationSeconds === null) dive.warnings.push("duration_unknown");
    if (dive.maxDepthMeters === null) dive.warnings.push("depth_unknown");
  }
  return dives;
}
