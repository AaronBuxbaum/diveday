import { parseCsv } from "./csv";
import { parseFit } from "./fit";
import { parseSubsurface } from "./subsurface";
import { COMPUTER_IMPORT_LIMITS as LIMIT, type ParsedComputerDive, refuse } from "./types";
import { parseUddf } from "./uddf";
import { descendants, localName, parseXml } from "./xml";

export { COMPUTER_CSV_TEMPLATE } from "./csv";
export * from "./types";
export function parseComputerFile(bytes: Uint8Array): ParsedComputerDive[] {
  if (bytes.byteLength > LIMIT.fileBytes) refuse("file_too_large");
  const isFit = bytes.length >= 12 && String.fromCharCode(...bytes.slice(8, 12)) === ".FIT";
  let text = "";
  if (!isFit) {
    try {
      text = new TextDecoder("utf-8", { fatal: true }).decode(bytes).trim();
    } catch {
      return refuse("invalid_encoding");
    }
  }
  let dives: ParsedComputerDive[];
  if (isFit) dives = parseFit(bytes);
  else if (text.startsWith("<")) {
    const root = parseXml(text);
    if (localName(root) === "uddf") dives = parseUddf(root);
    else if (
      (localName(root) === "divelog" || localName(root) === "dives") &&
      (root.attrs.program?.toLowerCase() === "subsurface" ||
        descendants(root, "program").some((p) => p.attrs.name?.toLowerCase() === "subsurface"))
    )
      dives = parseSubsurface(root);
    else return refuse("unsupported_format");
  } else if (text.startsWith("local_start,")) dives = parseCsv(text);
  else return refuse("unsupported_format");
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
