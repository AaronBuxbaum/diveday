import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { inspectCsvColumns } from "./csv";
import { parseComputerFile } from "./index";
import { type ComputerCsvMapping, validateComputerParseOptions } from "./options";

const bytes = (text: string) => new TextEncoder().encode(text);
const mapping: ComputerCsvMapping = {
  columns: { date: "When", duration: "Minutes", maxDepth: "Feet", utcOffset: "Offset" },
  dateFormat: "dmy",
  durationUnit: "minutes",
  depthUnit: "ft",
};
describe("explicit generic CSV mapping", () => {
  it("converts explicit minutes and feet, with the user's date ordering and offset", () => {
    const [dive] = parseComputerFile(
      bytes("When,Minutes,Feet,Offset\n03/04/2026 23:45,60,100,-04:00"),
      { csvMapping: mapping },
    );
    expect(dive).toMatchObject({
      localStart: "2026-04-03T23:45:00",
      startInstant: "2026-04-04T03:45:00.000Z",
      durationSeconds: 3600,
      maxDepthMeters: 30.48,
      sourceUnits: { depth: "ft" },
      csvMapping: mapping,
    });
  });
  it("keeps a calendar-only record without manufacturing a midnight instant", () => {
    const [dive] = parseComputerFile(bytes("When,Minutes,Feet,Offset\n01/11/2026,,,Z"), {
      csvMapping: mapping,
    });
    expect(dive).toMatchObject({
      localDate: "2026-11-01",
      localStart: null,
      startInstant: null,
      offsetMinutes: null,
      durationSeconds: null,
      maxDepthMeters: null,
    });
    expect(dive?.warnings).toEqual([
      "timezone_unknown",
      "date_only",
      "profile_absent",
      "duration_unknown",
      "depth_unknown",
    ]);
  });
  it("keeps the source depth unit unknown when no depth column was mapped", () => {
    const [dive] = parseComputerFile(bytes("Day\n2026-11-01"), {
      csvMapping: {
        columns: { date: "Day" },
        dateFormat: "iso",
        durationUnit: "seconds",
        depthUnit: "m",
      },
    });
    expect(dive?.sourceUnits.depth).toBeNull();
    expect(dive?.maxDepthMeters).toBeNull();
  });
  it("uses explicit MDY or DMY, and keeps unknown DST wall times unresolved", () => {
    const input = bytes("When,Minutes,Feet,Offset\n03/04/2026 01:30:00,,,unknown");
    expect(parseComputerFile(input, { csvMapping: mapping })[0]?.localStart).toBe(
      "2026-04-03T01:30:00",
    );
    expect(
      parseComputerFile(input, { csvMapping: { ...mapping, dateFormat: "mdy" } })[0]?.localStart,
    ).toBe("2026-03-04T01:30:00");
    expect(
      parseComputerFile(bytes("When\n2026-11-01 01:30"), {
        csvMapping: { ...mapping, dateFormat: "iso", columns: { date: "When" } },
      })[0],
    ).toMatchObject({
      startInstant: null,
      offsetMinutes: null,
      durationSeconds: null,
      maxDepthMeters: null,
    });
  });
  it("supports separate time and explicit embedded offset evidence", () => {
    const [separate] = parseComputerFile(bytes("Day,Clock\n2026-08-31,23:45"), {
      csvMapping: { ...mapping, dateFormat: "iso", columns: { date: "Day", time: "Clock" } },
    });
    expect(separate?.localStart).toBe("2026-08-31T23:45:00");
    const [embedded] = parseComputerFile(bytes("When\n2026-08-31T23:45Z"), {
      csvMapping: { ...mapping, dateFormat: "iso", columns: { date: "When" } },
    });
    expect(embedded?.startInstant).toBe("2026-08-31T23:45:00.000Z");
  });
  it.each([
    "31/02/2026 12:00,1,2,Z",
    "01/11/2026 24:00,1,2,Z",
    "01/11/2026 12:60,1,2,Z",
    "1/11/2026 12:00,1,2,Z",
    "01/11/2026 12:00,1,2,+14:01",
    "01/11/2026 12:00,1,2,",
    "01/11/2026 12:00Z,1,2,-04:00",
    "01/11/2026 12:00Z,1,2,unknown",
    "01/11/2026 12:00,NaN,2,Z",
    "01/11/2026 12:00,-1,2,Z",
    "01/11/2026 12:00,1,Infinity,Z",
  ])("refuses invalid or conflicting mapped values %s", (row) => {
    expect(() =>
      parseComputerFile(bytes(`When,Minutes,Feet,Offset\n${row}`), { csvMapping: mapping }),
    ).toThrow("invalid_value");
  });
  it("requires mapped columns and refuses simultaneous combined/separate times", () => {
    expect(() => parseComputerFile(bytes("Other\n2026-11-01"), { csvMapping: mapping })).toThrow(
      "invalid_csv",
    );
    expect(() =>
      parseComputerFile(bytes("When,Time\n2026-11-01T12:00,12:00"), {
        csvMapping: { ...mapping, dateFormat: "iso", columns: { date: "When", time: "Time" } },
      }),
    ).toThrow("invalid_value");
  });
  it("preserves template canonical content when the equivalent columns are mapped", () => {
    const input = new Uint8Array(
      readFileSync(`${import.meta.dirname}/fixtures/labelled-imperial.csv`),
    );
    const equivalent: ComputerCsvMapping = {
      columns: {
        date: "local_start",
        utcOffset: "utc_offset",
        device: "device",
        sourceId: "source_id",
        duration: "duration_seconds",
        maxDepth: "max_depth_ft",
      },
      dateFormat: "iso",
      durationUnit: "seconds",
      depthUnit: "ft",
    };
    const mapped = parseComputerFile(input, { csvMapping: equivalent }).map(
      ({ csvMapping: _, ...dive }) => dive,
    );
    expect(JSON.stringify(mapped)).toBe(JSON.stringify(parseComputerFile(input)));
    const padded = bytes(`\n  ${new TextDecoder().decode(input)}\n  `);
    expect(parseComputerFile(padded)).toEqual(parseComputerFile(input));
  });
  it("keeps intrinsic template units when another CSV's mapping accompanies the upload", () => {
    const input = new Uint8Array(
      readFileSync(`${import.meta.dirname}/fixtures/labelled-imperial.csv`),
    );
    expect(parseComputerFile(input, { csvMapping: mapping })).toEqual(parseComputerFile(input));
  });
  it("does not accept generic columns without the explicit choices", () => {
    expect(() => parseComputerFile(bytes("When,Minutes,Feet\n2026-01-01,1,2"))).toThrow(
      "unsupported_format",
    );
  });
});

describe("CSV inspection and untrusted options", () => {
  it("preserves exact spelling and quoting of safe header names", () => {
    expect(inspectCsvColumns(bytes(' Dive date ,"Depth, feet",Minutes\n2026-01-01,1,2'))).toEqual([
      " Dive date ",
      "Depth, feet",
      "Minutes",
    ]);
  });
  it.each([
    "Date,date",
    "Date, Date ",
    "__proto__,Date",
    "constructor,Date",
    "prototype,Date",
    '"Bad\nheader",Date',
    `${"x".repeat(257)},Date`,
    Array.from({ length: 65 }, (_, i) => `col${i}`).join(","),
  ])("refuses ambiguous or hostile headers %s", (header) => {
    expect(() => inspectCsvColumns(bytes(`${header}\n1,2`))).toThrow("invalid_csv");
  });
  it("bounds bytes and first-record scanning and rejects invalid UTF-8", () => {
    expect(() => inspectCsvColumns(new Uint8Array([0xc3, 0x28]))).toThrow("invalid_encoding");
    expect(() => inspectCsvColumns(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow("file_too_large");
    expect(() => inspectCsvColumns(bytes(`"${"a".repeat(40000)}"\n1`))).toThrow("invalid_csv");
  });
  it.each([
    null,
    [],
    { typo: true },
    { csvMapping: null },
    { csvMapping: {} },
    { csvMapping: { ...mapping, depthUnit: undefined } },
    { csvMapping: { ...mapping, depthUnit: "fathom" } },
    { csvMapping: { ...mapping, dateFormat: { toString: (): string => "iso" } } },
    { csvMapping: { ...mapping, extra: "ignored" } },
    { csvMapping: { ...mapping, columns: { ...mapping.columns, typo: "Value" } } },
    { csvMapping: { ...mapping, columns: { date: "__proto__" } } },
    { csvMapping: { ...mapping, columns: { date: "When", time: "When" } } },
    { csvMapping: { ...mapping, columns: { date: "When", device: undefined } } },
    { csvMapping: { ...mapping, columns: { date: " " } } },
  ])("refuses malformed options even for nonCSV input: %o", (options) => {
    expect(() => validateComputerParseOptions(options)).toThrow("invalid_options");
    const xml = new Uint8Array(readFileSync(`${import.meta.dirname}/fixtures/si.uddf`));
    expect(() => parseComputerFile(xml, options as never)).toThrow("invalid_options");
  });
  it("accepts absent options and copies well-formed choices", () => {
    expect(validateComputerParseOptions(undefined)).toEqual({});
    expect(validateComputerParseOptions({})).toEqual({});
    expect(validateComputerParseOptions({ csvMapping: mapping })).toEqual({ csvMapping: mapping });
  });
});

describe("re-importing our own computer-dive export", () => {
  it.each(["=SUM(A1)", "@cmd", "  =x", "＝x", "'Tis"])(
    "returns the device %j as typed",
    async (device) => {
      const { buildCsv } = await import("../csv");
      const csv = buildCsv(
        ["local_start", "utc_offset", "device", "source_id", "duration_seconds", "max_depth_m"],
        [["2026-01-01T12:00:00", "unknown", device, "=7", 1800, 20]],
      );
      const [dive] = parseComputerFile(bytes(csv));
      expect(dive).toMatchObject({ device: device.trim(), sourceId: "=7" });
    },
  );

  it("unguards mapped device and source columns", () => {
    const [dive] = parseComputerFile(
      bytes("When,Minutes,Feet,Offset,Unit,Id\n03/04/2026,60,100,Z,'=Shearwater,'@9"),
      {
        csvMapping: { ...mapping, columns: { ...mapping.columns, device: "Unit", sourceId: "Id" } },
      },
    );
    expect(dive).toMatchObject({ device: "=Shearwater", sourceId: "@9" });
  });
});
