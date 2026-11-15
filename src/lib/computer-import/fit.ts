import { Decoder, Profile, Stream } from "@garmin/fitsdk";
import {
  ComputerImportError,
  COMPUTER_IMPORT_LIMITS as LIMIT,
  type ParsedComputerDive,
  refuse,
} from "./types";

// The official decoder calls listeners after allocating the current message. Refusing
// immediately caps retained messages at the limit plus that single message. Definitions
// are separately bounded; unknown messages count too. Raw files are never retained here.
const MAX_MESSAGES = 50_000;
const MAX_DEFINITIONS = 10_000;

function measurement(value: unknown, min: number, max: number): number | null {
  if (value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value) || value < min || value > max)
    refuse("invalid_value");
  return value;
}

function instant(value: unknown): Date {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) refuse("invalid_value");
  return value;
}

/** Verified subset: one FIT diving session, native depth/temperature and gas definitions. */
export function parseFit(bytes: Uint8Array): ParsedComputerDive[] {
  if (bytes.byteLength > LIMIT.fileBytes) refuse("file_too_large");
  if (bytes.length < 14 || (bytes[0] !== 12 && bytes[0] !== 14)) refuse("invalid_value");
  const headerSize = bytes[0];
  const dataSize = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength).getUint32(
    4,
    true,
  );
  // The SDK accepts chained files; their session associations are outside this adapter.
  if (headerSize + dataSize + 2 !== bytes.length) refuse("invalid_value");
  const decoder = new Decoder(Stream.fromByteArray(bytes));
  if (!decoder.isFIT() || !decoder.checkIntegrity()) refuse("invalid_value");
  let messages = 0;
  let definitions = 0;
  let records = 0;
  let sessions = 0;
  const decoded = decoder.read({
    includeUnknownData: true,
    mergeHeartRates: false,
    mesgDefinitionListener: () => {
      if (++definitions > MAX_DEFINITIONS) refuse("limit_exceeded");
    },
    mesgListener: (number) => {
      if (++messages > MAX_MESSAGES) refuse("limit_exceeded");
      if (number === Profile.MesgNum.RECORD && ++records > LIMIT.samplesPerDive)
        refuse("limit_exceeded");
      if (number === Profile.MesgNum.SESSION && ++sessions > 1) refuse("unsupported_fit");
    },
  });
  if (decoded.errors.length) {
    const bounded = decoded.errors.find((error) => error instanceof ComputerImportError);
    if (bounded) throw bounded;
    refuse("invalid_value");
  }
  const data = decoded.messages;
  const retainedFields: Record<string, Set<string>> = {
    fileIdMesgs: new Set([
      "type",
      "manufacturer",
      "product",
      "productName",
      "garminProduct",
      "serialNumber",
    ]),
    sessionMesgs: new Set(["startTime", "sport", "totalElapsedTime", "messageIndex"]),
    diveSummaryMesgs: new Set(["referenceMesg", "referenceIndex", "maxDepth"]),
    recordMesgs: new Set(["timestamp", "depth", "temperature"]),
    diveGasMesgs: new Set(["messageIndex", "oxygenContent", "heliumContent"]),
  };
  const unmappedFields = Object.entries(data).some(([group, items]) =>
    items?.some((item: object) =>
      Object.keys(item).some((field) => !retainedFields[group]?.has(field)),
    ),
  );
  const file = data.fileIdMesgs?.[0];
  const session = data.sessionMesgs?.[0];
  if (data.fileIdMesgs?.length !== 1 || file?.type !== "activity" || session?.sport !== "diving")
    refuse("unsupported_fit");
  if (data.sessionMesgs?.length !== 1) refuse("unsupported_fit");
  if (
    (session.numLaps ?? 0) > 1 ||
    (data.lapMesgs?.length ?? 0) > 1 ||
    session.subSport === "apneaDiving" ||
    session.subSport === "apneaHunting"
  )
    refuse("unsupported_fit");
  if (data.tankSummaryMesgs?.length || data.tankUpdateMesgs?.length) refuse("unsupported_fit");
  const started = instant(session.startTime);
  const durationSeconds = measurement(session.totalElapsedTime, 0, 604800);
  const summaries = data.diveSummaryMesgs ?? [];
  const sessionIndex = session.messageIndex ?? 0;
  if (
    summaries.some(
      (summary) =>
        (summary.referenceMesg !== "session" && summary.referenceMesg !== "lap") ||
        (summary.referenceMesg === "session" && summary.referenceIndex !== sessionIndex),
    )
  )
    refuse("unsupported_fit");
  const sessionSummaries = summaries.filter((summary) => summary.referenceMesg === "session");
  const lapSummaries = summaries.filter((summary) => summary.referenceMesg === "lap");
  if (sessionSummaries.length > 1 || lapSummaries.length > 1) refuse("unsupported_fit");
  const maxDepthMeters = measurement(sessionSummaries[0]?.maxDepth, 0, 2000);
  const samples = (data.recordMesgs ?? []).flatMap((record) => {
    const depthMeters = measurement(record.depth, 0, 2000);
    if (depthMeters === null) return [];
    const seconds = (instant(record.timestamp).getTime() - started.getTime()) / 1000;
    if (seconds < 0 || seconds > 604800) refuse("invalid_value");
    const temperatureC = measurement(record.temperature, -100, 100);
    return [{ seconds, depthMeters, ...(temperatureC === null ? {} : { temperatureC }) }];
  });
  for (let i = 1; i < samples.length; i++)
    if ((samples[i]?.seconds ?? 0) <= (samples[i - 1]?.seconds ?? 0)) refuse("invalid_value");
  if (durationSeconds !== null && (samples.at(-1)?.seconds ?? 0) > durationSeconds)
    refuse("invalid_value");
  const rawGases = data.diveGasMesgs ?? [];
  if (rawGases.length > 32) refuse("limit_exceeded");
  const gases = rawGases.map((gas, index) => {
    const oxygen = measurement(gas.oxygenContent, 0, 100);
    const helium = measurement(gas.heliumContent, 0, 100);
    if ((oxygen ?? 0) + (helium ?? 0) > 100) refuse("invalid_value");
    return {
      id: String(gas.messageIndex ?? index),
      oxygenFraction: oxygen === null ? null : oxygen / 100,
      heliumFraction: helium === null ? null : helium / 100,
    };
  });
  if (new Set(gases.map((gas) => gas.id)).size !== gases.length) refuse("invalid_reference");
  return [
    {
      sourceFormat: "fit",
      sourceId: null,
      device:
        file.productName ?? (typeof file.garminProduct === "string" ? file.garminProduct : null),
      deviceId: file.serialNumber === undefined ? null : String(file.serialNumber),
      // FIT date_time is UTC. Its UTC representation is not the original local wall clock.
      localStart: null,
      startInstant: started.toISOString(),
      offsetMinutes: null,
      durationSeconds,
      maxDepthMeters,
      samples,
      gases,
      tanks: [],
      warnings: [
        "local_time_unknown",
        ...(durationSeconds === null ? [] : ["duration_elapsed"]),
        ...(unmappedFields ? ["unmapped_fit_fields"] : []),
      ],
      sourceUnits: {
        depth: "m",
        temperature: samples.some((sample) => sample.temperatureC !== undefined) ? "C" : null,
        pressure: null,
      },
    },
  ];
}
