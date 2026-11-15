import { readFileSync } from "node:fs";
import {
  CrcCalculator,
  Decoder,
  type Encodable,
  Encoder,
  type Mesg,
  Profile,
  Stream,
} from "@garmin/fitsdk";
import { describe, expect, it } from "vitest";
import { parseFit } from "./fit";
import { COMPUTER_IMPORT_LIMITS, ComputerImportError } from "./types";

const authentic = () =>
  new Uint8Array(readFileSync(`${import.meta.dirname}/fixtures/garmin-connect-summary-first.fit`));

const start = 315532800;
type Message = Encodable<Mesg> & Record<string, unknown>;
const message = (number: string, fields: Record<string, unknown>): Message => ({
  mesgNum: Profile.MesgNum[number] as number,
  ...fields,
});
const file = message("FILE_ID", { type: "activity" });
const session = message("SESSION", { sport: "diving", startTime: start, totalElapsedTime: 60 });
function encoded(messages: Message[]): Uint8Array {
  const encoder = new Encoder();
  for (const item of messages) encoder.writeMesg(item);
  return encoder.close();
}
function errorCode(bytes: Uint8Array): string | undefined {
  try {
    parseFit(bytes);
  } catch (error) {
    expect(error).toBeInstanceOf(ComputerImportError);
    return (error as ComputerImportError).code;
  }
}

describe("official FIT adapter", () => {
  it("reads the licensed anonymized Garmin Connect summary-first export", () => {
    const [dive] = parseFit(authentic());
    expect(dive).toMatchObject({
      sourceFormat: "fit",
      localStart: null,
      startInstant: "2000-01-01T00:00:00.000Z",
      offsetMinutes: null,
      maxDepthMeters: 46.204,
      tanks: [],
      warnings: expect.arrayContaining(["local_time_unknown"]),
    });
    expect(dive?.gases).toEqual([
      { id: "0", oxygenFraction: 0.21, heliumFraction: 0 },
      { id: "1", oxygenFraction: 0.5, heliumFraction: 0 },
    ]);
    expect(dive?.samples).toHaveLength(3267);
    expect(Math.max(...(dive?.samples.map((s) => s.depthMeters) ?? []))).toBe(46.204);
    expect(dive?.samples[0]).toEqual({ seconds: 0, depthMeters: 1.351, temperatureC: 22 });
    expect(dive?.samples.at(-1)?.seconds).toBe(4271);
    expect(dive?.durationSeconds).toBeGreaterThanOrEqual(4271);
  });

  it.each([0, 1, 8, 12, 100])("rejects truncation at %s bytes", (length) => {
    expect(() => parseFit(authentic().slice(0, length))).toThrow();
  });

  it("rejects CRC corruption", () => {
    const bytes = authentic();
    bytes[100] = (bytes[100] ?? 0) ^ 1;
    expect(() => parseFit(bytes)).toThrow();
  });

  it("discards object-valued SDK product enums from CRC-valid malformed field types", () => {
    const prototypeBefore = Object.getOwnPropertyDescriptors(Object.prototype);
    const original = encoded([
      message("FILE_ID", { type: "activity", manufacturer: "garmin", product: 4222 }),
      session,
    ]);
    // Pinned SDK Encoder layout: product field 2 is a two-byte uint16. Change
    // its native definition to a ten-byte string, preserving an otherwise valid file.
    expect(Array.from(original.slice(26, 29))).toEqual([2, 2, 0x84]);
    const bytes = new Uint8Array(original.length + 8);
    bytes.set(original.subarray(0, 33));
    bytes.set(new TextEncoder().encode("__proto__\0"), 33);
    bytes.set(original.subarray(35), 43);
    bytes[27] = 10;
    bytes[28] = 7;
    const view = new DataView(bytes.buffer);
    view.setUint32(4, view.getUint32(4, true) + 8, true);
    view.setUint16(12, CrcCalculator.calculateCRC(bytes, 0, 12), true);
    view.setUint16(bytes.length - 2, CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2), true);

    const decoder = new Decoder(Stream.fromByteArray(bytes));
    expect(decoder.checkIntegrity()).toBe(true);
    const decoded = decoder.read();
    expect(decoded.errors).toEqual([]);
    expect(decoded.messages.fileIdMesgs?.[0]?.garminProduct).toBe(Object.prototype);

    const [dive] = parseFit(bytes);
    expect(dive?.device).toBeNull();
    expect(dive?.deviceId).toBeNull();
    expect(JSON.stringify(dive)).not.toContain("__proto__");
    expect(Object.getOwnPropertyDescriptors(Object.prototype)).toEqual(prototypeBefore);
  });

  it("rejects a forged huge size before decoding", () => {
    const bytes = authentic();
    new DataView(bytes.buffer).setUint32(4, 0xffffffff, true);
    expect(() => parseFit(bytes)).toThrow();
  });

  it("rejects concatenated activities rather than silently selecting one", () => {
    const bytes = authentic();
    const chained = new Uint8Array(bytes.length * 2);
    chained.set(bytes);
    chained.set(bytes, bytes.length);
    expect(() => parseFit(chained)).toThrow();
  });

  it("warns that additional native telemetry and events are omitted", () => {
    expect(parseFit(authentic())[0]?.warnings).toEqual([
      "local_time_unknown",
      "duration_elapsed",
      "unmapped_fit_fields",
    ]);
  });

  it("reads exactly a Uint8Array view rather than surrounding bytes", () => {
    const bytes = authentic();
    const larger = new Uint8Array(bytes.length + 10);
    larger.set(bytes, 5);
    expect(parseFit(larger.subarray(5, 5 + bytes.length))).toEqual(parseFit(bytes));
  });

  it("keeps absent profile, duration, depth, gases and local clock unknown", () => {
    const [dive] = parseFit(
      encoded([file, message("SESSION", { sport: "diving", startTime: start })]),
    );
    expect(dive).toMatchObject({
      localStart: null,
      offsetMinutes: null,
      durationSeconds: null,
      maxDepthMeters: null,
      samples: [],
      gases: [],
      tanks: [],
      device: null,
    });
  });

  it("accepts summary-last native SI values without converting metres twice", () => {
    const [dive] = parseFit(
      encoded([
        file,
        message("RECORD", { timestamp: start, depth: 10.125, temperature: -2 }),
        session,
        message("DIVE_SUMMARY", { referenceMesg: "session", referenceIndex: 0, maxDepth: 10.125 }),
      ]),
    );
    expect(dive?.maxDepthMeters).toBe(10.125);
    expect(dive?.samples).toEqual([{ seconds: 0, depthMeters: 10.125, temperatureC: -2 }]);
  });

  it("preserves a UTC cross-midnight profile without inventing an offset", () => {
    const midnightStart = start + 86390;
    const [dive] = parseFit(
      encoded([
        file,
        message("SESSION", { sport: "diving", startTime: midnightStart, totalElapsedTime: 30 }),
        message("RECORD", { timestamp: midnightStart, depth: 1 }),
        message("RECORD", { timestamp: midnightStart + 20, depth: 0 }),
      ]),
    );
    expect(dive?.startInstant).toBe("1999-12-31T23:59:50.000Z");
    expect(dive?.offsetMinutes).toBeNull();
    expect(dive?.localStart).toBeNull();
    expect(dive?.samples.map((sample) => sample.seconds)).toEqual([0, 20]);
  });

  it.each([
    ["non-dive", [file, message("SESSION", { sport: "running", startTime: start })]],
    ["multiple sessions", [file, session, session]],
    [
      "multiple dive summaries",
      [
        file,
        session,
        message("DIVE_SUMMARY", { referenceMesg: "lap", referenceIndex: 0 }),
        message("DIVE_SUMMARY", { referenceMesg: "lap", referenceIndex: 1 }),
      ],
    ],
    [
      "freedive multi-descent activity",
      [file, message("SESSION", { sport: "diving", subSport: "apneaDiving", startTime: start })],
    ],
    [
      "multiple laps",
      [file, message("SESSION", { sport: "diving", startTime: start, numLaps: 2 })],
    ],
    ["multiple file IDs", [file, file, session]],
    ["workout file", [message("FILE_ID", { type: "workout" }), session]],
    ["no session", [file]],
    [
      "tank telemetry not yet fixture verified",
      [file, session, message("TANK_UPDATE", { timestamp: start })],
    ],
    [
      "unmatched summary",
      [file, session, message("DIVE_SUMMARY", { referenceMesg: "session", referenceIndex: 4 })],
    ],
    [
      "repeated session summary",
      [
        file,
        session,
        message("DIVE_SUMMARY", { referenceMesg: "session", referenceIndex: 0 }),
        message("DIVE_SUMMARY", { referenceMesg: "session", referenceIndex: 0 }),
      ],
    ],
  ])("rejects %s evidence", (_name, messages) => {
    expect(errorCode(encoded(messages as Message[]))).toBe("unsupported_fit");
  });

  it.each([
    ["no start instant", [file, message("SESSION", { sport: "diving" })]],
    [
      "profile before start",
      [file, session, message("RECORD", { timestamp: start - 1, depth: 1 })],
    ],
    [
      "profile exceeds elapsed duration",
      [file, session, message("RECORD", { timestamp: start + 61, depth: 1 })],
    ],
    ["missing depth timestamp", [file, session, message("RECORD", { depth: 1 })]],
    [
      "repeated profile timestamp",
      [
        file,
        session,
        message("RECORD", { timestamp: start, depth: 1 }),
        message("RECORD", { timestamp: start, depth: 2 }),
      ],
    ],
    [
      "out of order profile",
      [
        file,
        session,
        message("RECORD", { timestamp: start + 2, depth: 1 }),
        message("RECORD", { timestamp: start, depth: 2 }),
      ],
    ],
    ["unphysical depth", [file, session, message("RECORD", { timestamp: start, depth: 2001 })]],
    [
      "impossible gas",
      [
        file,
        session,
        message("DIVE_GAS", { messageIndex: 0, oxygenContent: 90, heliumContent: 20 }),
      ],
    ],
  ])("rejects %s", (_name, messages) => {
    expect(errorCode(encoded(messages as Message[]))).toBe("invalid_value");
  });

  it("bounds samples during official decoding", () => {
    const records = Array.from({ length: COMPUTER_IMPORT_LIMITS.samplesPerDive + 1 }, (_, index) =>
      message("RECORD", { timestamp: start + index, depth: 1 }),
    );
    expect(errorCode(encoded([file, session, ...records]))).toBe("limit_exceeded");
  });

  it("bounds non-profile messages during official decoding", () => {
    const events = Array.from({ length: 50_000 }, () => message("EVENT", { timestamp: start }));
    expect(errorCode(encoded([file, session, ...events]))).toBe("limit_exceeded");
  });

  it("bounds repeated definitions before decoding any messages", () => {
    // A fieldless local definition is six bytes; CRCs come from the official SDK.
    const definition = new Uint8Array([0x40, 0, 0, 20, 0, 0]);
    const dataSize = definition.length * 10_001;
    const bytes = new Uint8Array(12 + dataSize + 2);
    bytes.set(encoded([]).slice(0, 12));
    bytes[0] = 12;
    const view = new DataView(bytes.buffer);
    view.setUint32(4, dataSize, true);
    for (let offset = 12; offset < 12 + dataSize; offset += definition.length)
      bytes.set(definition, offset);
    view.setUint16(bytes.length - 2, CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2), true);
    expect(errorCode(bytes)).toBe("limit_exceeded");
  });

  it("rejects malformed definitions even with a correct file CRC", () => {
    const bytes = encoded([file, session]);
    bytes[bytes[0] ?? 0] = 0x0f;
    new DataView(bytes.buffer).setUint16(
      bytes.length - 2,
      CrcCalculator.calculateCRC(bytes, 0, bytes.length - 2),
      true,
    );
    expect(errorCode(bytes)).toBe("invalid_value");
  });

  it("refuses oversized bytes before invoking the decoder", () => {
    expect(errorCode(new Uint8Array(COMPUTER_IMPORT_LIMITS.fileBytes + 1))).toBe("file_too_large");
  });

  it("keeps a record with no depth out of the depth profile", () => {
    expect(
      parseFit(
        encoded([file, session, message("RECORD", { timestamp: start, temperature: 20 })]),
      )[0]?.samples,
    ).toEqual([]);
  });

  it("rejects repeated gas reference IDs", () => {
    expect(
      errorCode(
        encoded([
          file,
          session,
          message("DIVE_GAS", { messageIndex: 0 }),
          message("DIVE_GAS", { messageIndex: 0 }),
        ]),
      ),
    ).toBe("invalid_reference");
  });
});
