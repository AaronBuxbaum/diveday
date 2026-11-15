import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { parseComputerFile } from "./index";

const bytes = (s: string) => new TextEncoder().encode(s);
const fixture = (name: string) =>
  new Uint8Array(readFileSync(`${import.meta.dirname}/fixtures/${name}`));
describe("computer file parsing", () => {
  it("preserves UDDF SI values, references and unknown timezone across midnight", () => {
    const [dive] = parseComputerFile(fixture("si.uddf"));
    expect(dive).toMatchObject({
      sourceFormat: "uddf",
      sourceId: "d1",
      device: "Fixture computer",
      localStart: "2026-11-01T23:50:00",
      startInstant: null,
      offsetMinutes: null,
      durationSeconds: 1800,
      maxDepthMeters: 20,
    });
    expect(dive?.samples[1]).toEqual({ seconds: 600, depthMeters: 20, temperatureC: 20 });
    expect(dive?.gases).toEqual([
      { id: "air", oxygenFraction: 0.21, heliumFraction: 0 },
      { id: "ean", oxygenFraction: 0.32, heliumFraction: 0 },
    ]);
    expect(dive?.tanks[0]).toEqual({
      gasId: "air",
      volumeLiters: 12,
      startPressureBar: 200,
      endPressureBar: 50,
    });
    expect(dive?.warnings).toContain("timezone_unknown");
  });
});

describe("explicit units, wall time and independent recordings", () => {
  it("keeps each Subsurface computer and its own profile", () => {
    const dives = parseComputerFile(fixture("multiple-computers.xml"));
    expect(dives).toHaveLength(2);
    expect(dives.map((d) => [d.sourceId, d.device, d.maxDepthMeters, d.samples.length])).toEqual([
      ["a:42", "Fixture A", 20, 3],
      ["b:42", "Fixture B", 21, 2],
    ]);
    expect(dives[0]?.gases[1]).toEqual({ id: "1", oxygenFraction: 0.5, heliumFraction: null });
    expect(dives[0]?.tanks[0]).toEqual({
      gasId: "0",
      volumeLiters: 12,
      startPressureBar: 200,
      endPressureBar: 60,
    });
    expect(
      dives.every((d) => d.startInstant === null && d.warnings.includes("multiple_recordings")),
    ).toBe(true);
  });
  it("converts labelled feet and preserves offset before a cross-midnight duration", () => {
    const [dive, unknown] = parseComputerFile(fixture("labelled-imperial.csv"));
    expect(dive).toMatchObject({
      localStart: "2026-08-31T23:45:00",
      startInstant: "2026-09-01T03:45:00.000Z",
      offsetMinutes: -240,
      durationSeconds: 3600,
      maxDepthMeters: 30.48,
      sourceUnits: { depth: "ft" },
    });
    expect(unknown).toMatchObject({
      localStart: "2026-11-01T01:30:00",
      startInstant: null,
      offsetMinutes: null,
      durationSeconds: null,
      maxDepthMeters: null,
      samples: [],
    });
    expect(unknown?.warnings).toEqual(
      expect.arrayContaining([
        "timezone_unknown",
        "duration_unknown",
        "depth_unknown",
        "profile_absent",
      ]),
    );
  });
  it("never applies the host timezone or resolves a DST fold implicitly", () => {
    const csv = (offset: string) =>
      bytes(
        `local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n2026-11-01T01:30:00,${offset},A,1,1800,20`,
      );
    expect(parseComputerFile(csv("-04:00"))[0]?.startInstant).toBe("2026-11-01T05:30:00.000Z");
    expect(parseComputerFile(csv("-05:00"))[0]?.startInstant).toBe("2026-11-01T06:30:00.000Z");
    expect(parseComputerFile(csv("-00:00"))[0]?.startInstant).toBeNull();
  });
});

describe("hostile and ambiguous input", () => {
  it.each([
    ['<!DOCTYPE uddf [<!ENTITY a SYSTEM "file:///etc/passwd">]><uddf/>', "unsafe_xml"],
    ['<!DOCTYPE uddf SYSTEM "https://example.com/test.dtd"><uddf/>', "unsafe_xml"],
    ["<uddf>&secret;</uddf>", "unsafe_xml"],
    ["<uddf><dive></uddf>", "invalid_xml"],
    ['<uddf id="one" id="two"/>', "invalid_xml"],
    ["<uddf/><uddf/>", "invalid_xml"],
    ["<?other x?><uddf/>", "invalid_xml"],
    ["<uddf><a>one & two</a></uddf>", "unsafe_xml"],
    ['<uddf><a attr="unterminated></a></uddf>', "invalid_xml"],
    ['<uddf><link ref="https://example.com/a"/></uddf>', "invalid_reference"],
    ['<uddf><a id="same"/><b id="same"/></uddf>', "invalid_reference"],
    ["<uddf/>", "no_dives"],
    ["https://example.com/dives.uddf", "unsupported_format"],
  ])("refuses %s", (input, code) => {
    expect(() => parseComputerFile(bytes(input))).toThrow(code);
  });
  it("refuses malformed UTF-8 and invalid FIT headers", () => {
    expect(() => parseComputerFile(new Uint8Array([0xc3, 0x28]))).toThrow("invalid_encoding");
    const fit = new Uint8Array(12);
    fit.set(bytes(".FIT"), 8);
    expect(() => parseComputerFile(fit)).toThrow("invalid_value");
  });
  it("bounds byte size, XML nesting, nodes, text and samples", () => {
    expect(() => parseComputerFile(new Uint8Array(5 * 1024 * 1024 + 1))).toThrow("file_too_large");
    expect(() =>
      parseComputerFile(bytes(`<uddf>${"<a>".repeat(34)}${"</a>".repeat(34)}</uddf>`)),
    ).toThrow("limit_exceeded");
    expect(() => parseComputerFile(bytes(`<uddf><a>${"x".repeat(4097)}</a></uddf>`))).toThrow(
      "limit_exceeded",
    );
    const uddf = new TextDecoder().decode(fixture("si.uddf"));
    const points = Array.from(
      { length: 10001 },
      (_, i) => `<waypoint><divetime>${i}</divetime><depth>0</depth></waypoint>`,
    ).join("");
    expect(() =>
      parseComputerFile(
        bytes(uddf.replace(/<samples>[\s\S]*?<\/samples>/, `<samples>${points}</samples>`)),
      ),
    ).toThrow("limit_exceeded");
  });
  it("refuses unlabelled depth columns, conflicting units, bad dates and nonfinite values", () => {
    const csv = new TextDecoder().decode(fixture("labelled-imperial.csv"));
    for (const changed of [
      csv.replace("max_depth_ft", "depth"),
      csv.replace("2026-08-31", "2026-02-31"),
      csv.replace(",3600,100", ",3600,NaN"),
      csv.replace("-04:00", "+15:00"),
      csv.replace("unknown,Fixture", " ,Fixture"),
    ])
      expect(() => parseComputerFile(bytes(changed))).toThrow();
    const xml = new TextDecoder().decode(fixture("multiple-computers.xml"));
    expect(() => parseComputerFile(bytes(xml.replace("20.0 m", "20.0")))).toThrow("unknown_units");
    expect(() =>
      parseComputerFile(bytes(xml.replace('depth="20.0 m"', 'depth="60.0 ft"'))),
    ).toThrow("unknown_units");
  });
  it("refuses impossible gas fractions, reversed sample times and samples past stated duration", () => {
    const xml = new TextDecoder().decode(fixture("si.uddf"));
    expect(() =>
      parseComputerFile(bytes(xml.replace("<o2>0.32</o2><he>0</he>", "<o2>0.9</o2><he>0.3</he>"))),
    ).toThrow("invalid_value");
    expect(() =>
      parseComputerFile(
        bytes(xml.replace("<divetime>1800</divetime>", "<divetime>400</divetime>")),
      ),
    ).toThrow("invalid_value");
    expect(() =>
      parseComputerFile(
        bytes(
          xml.replace("<diveduration>1800</diveduration>", "<diveduration>1700</diveduration>"),
        ),
      ),
    ).toThrow("invalid_value");
  });
  it("handles harmless built-in entities but never retains source notes", () => {
    const xml = new TextDecoder()
      .decode(fixture("si.uddf"))
      .replace("Fixture computer", "Fixture &amp; Computer")
      .replace("<samples>", "<notes>Private text</notes><samples>");
    const [dive] = parseComputerFile(bytes(xml));
    expect(dive?.device).toBe("Fixture & Computer");
    expect(JSON.stringify(dive)).not.toContain("Private text");
  });
});
