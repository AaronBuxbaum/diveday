import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { crc32, deflateRawSync } from "node:zlib";
import { zipSync } from "fflate";
import { describe, expect, it } from "vitest";
import { parseComputerFile } from "./index";

const bytes = (text: string) => new TextEncoder().encode(text);
const fixture = (name: string) =>
  new Uint8Array(readFileSync(`${import.meta.dirname}/fixtures/${name}`));
const unsigned = (data: Uint8Array, at: number, value: number, width = 4) => {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (width === 2) view.setUint16(at, value, true);
  else view.setUint32(at, value, true);
};
function central(data: Uint8Array) {
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  for (let at = 0; at + 46 < data.length; at++)
    if (view.getUint32(at, true) === 0x02014b50) return at;
  throw new Error("missing_test_directory");
}
function changed(input: Uint8Array, mutate: (data: Uint8Array, directory: number) => void) {
  const data = input.slice();
  mutate(data, central(data));
  return data;
}
function craftedEntry(payload: Uint8Array, declaredSize: number, name = "dive.csv") {
  const compressed = deflateRawSync(payload);
  const encodedName = bytes(name);
  const header = new Uint8Array(30 + encodedName.length);
  unsigned(header, 0, 0x04034b50);
  unsigned(header, 4, 20, 2);
  unsigned(header, 8, 8, 2);
  unsigned(header, 14, crc32(payload));
  unsigned(header, 18, compressed.length);
  unsigned(header, 22, declaredSize);
  unsigned(header, 26, encodedName.length, 2);
  header.set(encodedName, 30);
  const directory = new Uint8Array(46 + encodedName.length);
  unsigned(directory, 0, 0x02014b50);
  unsigned(directory, 4, 20, 2);
  unsigned(directory, 6, 20, 2);
  unsigned(directory, 10, 8, 2);
  unsigned(directory, 16, crc32(payload));
  unsigned(directory, 20, compressed.length);
  unsigned(directory, 24, declaredSize);
  unsigned(directory, 28, encodedName.length, 2);
  directory.set(encodedName, 46);
  const end = new Uint8Array(22);
  unsigned(end, 0, 0x06054b50);
  unsigned(end, 8, 1, 2);
  unsigned(end, 10, 1, 2);
  unsigned(end, 12, directory.length);
  unsigned(end, 16, header.length + compressed.length);
  const archive = new Uint8Array(header.length + compressed.length + directory.length + end.length);
  let offset = 0;
  for (const part of [header, compressed, directory, end]) {
    archive.set(part, offset);
    offset += part.length;
  }
  return archive;
}
function withDescriptor(input: Uint8Array, signed: boolean) {
  const at = central(input);
  const descriptor = new Uint8Array(signed ? 16 : 12);
  const offset = signed ? 4 : 0;
  if (signed) unsigned(descriptor, 0, 0x08074b50);
  const view = new DataView(input.buffer, input.byteOffset, input.byteLength);
  unsigned(descriptor, offset, view.getUint32(14, true));
  unsigned(descriptor, offset + 4, view.getUint32(18, true));
  unsigned(descriptor, offset + 8, view.getUint32(22, true));
  const output = new Uint8Array(input.length + descriptor.length);
  output.set(input.subarray(0, at));
  output.set(descriptor, at);
  output.set(input.subarray(at), at + descriptor.length);
  unsigned(output, 6, 8, 2);
  unsigned(output, at + descriptor.length + 8, 8, 2);
  for (const field of [14, 18, 22]) unsigned(output, field, 0);
  unsigned(output, output.length - 6, at + descriptor.length);
  return output;
}
describe("bounded ZIP transport", () => {
  it("imports supported entries without changing their evidence and reports ignored attachments", () => {
    const input = fixture("si.uddf");
    const [dive] = parseComputerFile(
      zipSync({ "logs/dive.uddf": input, "readme.txt": bytes("Instructions") }),
    );
    expect(dive).toMatchObject({ archiveEntry: "logs/dive.uddf", archiveIgnoredEntries: 1 });
    if (!dive) throw new Error("missing_imported_dive");
    const {
      archiveEntry: _,
      archiveIgnoredEntries: __,
      archiveEntryHash: ___,
      archiveEntryRecordIndex: ____,
      ...content
    } = dive;
    expect(JSON.stringify(content)).toBe(JSON.stringify(parseComputerFile(input)[0]));
    expect(dive?.archiveEntryHash).toBe(createHash("sha256").update(input).digest("hex"));
    expect(dive?.archiveEntryRecordIndex).toBe(0);
  });
  it("reads stored and DEFLATE entries including multiple computer recordings", () => {
    const archive = zipSync({
      "a.uddf": [fixture("si.uddf"), { level: 0 }],
      "b.xml": fixture("multiple-computers.xml"),
    });
    const dives = parseComputerFile(archive);
    expect(dives.map((dive) => [dive.archiveEntry, dive.archiveEntryRecordIndex])).toEqual([
      ["a.uddf", 0],
      ["b.xml", 0],
      ["b.xml", 1],
    ]);
  });
  it("validates signed and unsigned streaming data descriptors", () => {
    const archive = zipSync({ "dive.uddf": fixture("si.uddf") });
    for (const signed of [false, true]) {
      const streamed = withDescriptor(archive, signed);
      expect(parseComputerFile(streamed)[0]?.sourceId).toBe("d1");
      const corrupted = streamed.slice();
      unsigned(corrupted, central(archive) + (signed ? 4 : 0), 111);
      expect(() => parseComputerFile(corrupted)).toThrow("invalid_archive");
    }
  });
  it("checks Unicode flags and names before handling any payload", () => {
    expect(
      parseComputerFile(zipSync({ "logs/潜水.uddf": fixture("si.uddf") }))[0]?.archiveEntry,
    ).toBe("logs/潜水.uddf");
    const archive = zipSync({ "dive.uddf": fixture("si.uddf") });
    expect(() =>
      parseComputerFile(
        changed(archive, (data, at) => {
          data[30] = 255;
          data[at + 46] = 255;
        }),
      ),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(
        changed(archive, (data, at) => {
          unsigned(data, 6, 0x0800, 2);
          unsigned(data, at + 8, 0x0800, 2);
          data[30] = 255;
          data[at + 46] = 255;
        }),
      ),
    ).toThrow("unsafe_archive");
    expect(() => parseComputerFile(zipSync({ "．．/dive.uddf": fixture("si.uddf") }))).toThrow(
      "unsafe_archive",
    );
  });
  it("accepts empty directories and a ZIP comment but never counts directories as attachments", () => {
    const input = zipSync({
      "logs/": [new Uint8Array(), { level: 0 }],
      "logs/dive.uddf": fixture("si.uddf"),
    });
    const commented = new Uint8Array([...input, ...bytes("Synthetic ZIP")]);
    unsigned(commented, input.length - 2, 13, 2);
    expect(parseComputerFile(commented)[0]).toMatchObject({
      sourceId: "d1",
      archiveIgnoredEntries: 0,
    });
    const deflatedDirectory = zipSync({
      "logs/": new Uint8Array(),
      "logs/dive.uddf": fixture("si.uddf"),
    });
    expect(parseComputerFile(deflatedDirectory)[0]?.archiveIgnoredEntries).toBe(0);
  });
  it("validates the checked-in synthetic multi-entry fixture", () => {
    const dives = parseComputerFile(fixture("multi-entry.zip"));
    expect(
      dives.map((dive) => [dive.sourceId, dive.archiveEntry, dive.archiveIgnoredEntries]),
    ).toEqual([
      ["d1", "logs/si.uddf", 2],
      ["1", "logs/summary.csv", 2],
    ]);
    const {
      archiveEntry: _,
      archiveIgnoredEntries: __,
      archiveEntryHash: ___,
      archiveEntryRecordIndex: ____,
      ...content
    } = dives[0] ?? {};
    expect(content).toEqual(parseComputerFile(fixture("si.uddf"))[0]);
  });
  it("uses entry-local identity when a date-only file follows another entry", () => {
    const csv = bytes("Date\n2026-11-01\n2026-11-01");
    const options = {
      csvMapping: {
        columns: { date: "Date" },
        dateFormat: "iso",
        durationUnit: "seconds",
        depthUnit: "m",
      },
    } as const;
    const dives = parseComputerFile(
      zipSync({ "a.uddf": fixture("si.uddf"), "dates.csv": csv }),
      options,
    );
    const hash = createHash("sha256").update(csv).digest("hex");
    expect(
      dives
        .slice(1)
        .map((dive) => [dive.archiveEntryHash, dive.archiveEntryRecordIndex, dive.localDate]),
    ).toEqual([
      [hash, 0, "2026-11-01"],
      [hash, 1, "2026-11-01"],
    ]);
  });
  it("applies generic mapping alongside intrinsically labelled template entries", () => {
    const options = {
      csvMapping: {
        columns: { date: "Day" },
        dateFormat: "iso",
        durationUnit: "seconds",
        depthUnit: "m",
      },
    } as const;
    const dives = parseComputerFile(
      zipSync({
        "mapped.csv": bytes("Day\n2026-11-01"),
        "template.csv": fixture("labelled-imperial.csv"),
      }),
      options,
    );
    expect(dives).toHaveLength(3);
    expect(dives[0]?.localDate).toBe("2026-11-01");
    expect(dives[1]?.maxDepthMeters).toBe(30.48);
  });
  it("propagates malformed supported input and XML entity refusals without partial import", () => {
    expect(() =>
      parseComputerFile(
        zipSync({ "good.uddf": fixture("si.uddf"), "bad.xml": bytes("<uddf><dive></uddf>") }),
      ),
    ).toThrow("invalid_xml");
    expect(() =>
      parseComputerFile(
        zipSync({
          "bad.uddf": bytes('<!DOCTYPE uddf [<!ENTITY a SYSTEM "file:///etc/passwd">]><uddf/>'),
        }),
      ),
    ).toThrow("unsafe_xml");
    expect(() => parseComputerFile(zipSync({ "not-supported.xml": bytes("<other/>") }))).toThrow(
      "unsupported_format",
    );
  });
  it.each([
    "../dive.uddf",
    "/dive.uddf",
    "a/../dive.uddf",
    "a\\dive.uddf",
    "https://example.com/dive.uddf",
    "C:/dive.uddf",
    "./dive.uddf",
    "a//dive.uddf",
    "a/ dive.uddf",
  ])("rejects unsafe path %s", (path) => {
    expect(() => parseComputerFile(zipSync({ [path]: fixture("si.uddf") }))).toThrow(
      "unsafe_archive",
    );
  });
  it("rejects symlinks, encryption, unsupported compression and ZIP64", () => {
    const archive = zipSync({ "dive.uddf": fixture("si.uddf") });
    expect(() =>
      parseComputerFile(changed(archive, (data, at) => unsigned(data, at + 38, 0xa1ff0000))),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(changed(archive, (data, at) => unsigned(data, at + 8, 1, 2))),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(changed(archive, (data, at) => unsigned(data, at + 10, 12, 2))),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(changed(archive, (data, at) => unsigned(data, at + 24, 0xffffffff))),
    ).toThrow("unsafe_archive");
  });
  it("rejects duplicate paths, nested archives and archives with no supported dives", () => {
    expect(() =>
      parseComputerFile(zipSync({ "A.uddf": fixture("si.uddf"), "a.uddf": fixture("si.uddf") })),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(zipSync({ "inside.zip": zipSync({ "dive.uddf": fixture("si.uddf") }) })),
    ).toThrow("unsafe_archive");
    expect(() =>
      parseComputerFile(zipSync({ "image.jpg": zipSync({ "dive.uddf": fixture("si.uddf") }) })),
    ).toThrow("unsafe_archive");
    expect(() => parseComputerFile(zipSync({ "notes.txt": bytes("Only notes") }))).toThrow(
      "no_dives",
    );
  });
  it("checks local and central names, sizes, CRCs, intervals, trailing bytes and truncation", () => {
    const archive = zipSync({ "dive.uddf": fixture("si.uddf") });
    for (const forged of [
      changed(archive, (data) => {
        data[30] = 65;
      }),
      changed(archive, (data, at) => unsigned(data, at + 24, 7)),
      changed(archive, (data, at) => {
        unsigned(data, at + 16, 123);
        unsigned(data, 14, 123);
      }),
      changed(archive, (data, at) => unsigned(data, at + 42, 1)),
      changed(archive, (data) => unsigned(data, 18, 1)),
      new Uint8Array([...archive, 0]),
      archive.subarray(0, archive.length - 1),
    ])
      expect(() => parseComputerFile(forged)).toThrow("invalid_archive");
  });
  it("bounds entry count, declared output, expansion ratio and actual forged DEFLATE output", () => {
    expect(() =>
      parseComputerFile(
        zipSync(Object.fromEntries(Array.from({ length: 21 }, (_, i) => [`${i}.txt`, bytes("x")]))),
      ),
    ).toThrow("archive_limit_exceeded");
    expect(() => parseComputerFile(craftedEntry(bytes("x"), 5 * 1024 * 1024 + 1))).toThrow(
      "archive_limit_exceeded",
    );
    expect(() => parseComputerFile(craftedEntry(new Uint8Array(100_000), 100_000))).toThrow(
      "archive_limit_exceeded",
    );
    expect(() => parseComputerFile(craftedEntry(new Uint8Array(5 * 1024 * 1024 + 1), 1))).toThrow(
      "archive_limit_exceeded",
    );
  });
  it("bounds aggregate expanded bytes including ignored attachments", () => {
    // A repeated, deterministic block compresses below 200:1 while keeping the
    // outer archive below 5 MiB, so each entry is valid before the aggregate check.
    const block = new Uint8Array(8192);
    let state = 12345;
    for (let index = 0; index < block.length; index++) {
      state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
      block[index] = state >>> 24;
    }
    const payload = new Uint8Array(4 * 1024 * 1024);
    for (let at = 0; at < payload.length; at += block.length) payload.set(block, at);
    const two = zipSync({
      "one.jpg": payload,
      "two.jpg": payload,
      "dive.uddf": fixture("si.uddf"),
    });
    expect(parseComputerFile(two)[0]?.archiveIgnoredEntries).toBe(2);
    const three = zipSync({ "one.jpg": payload, "two.jpg": payload, "three.jpg": payload });
    expect(() => parseComputerFile(three)).toThrow("archive_limit_exceeded");
  });
  it("bounds aggregate dives and samples across individually valid entries", () => {
    const header = "local_start,utc_offset,device,source_id,duration_seconds,max_depth_m\n";
    const csv = bytes(
      header +
        Array.from({ length: 251 }, (_, i) => `2026-01-01T12:00:00,unknown,A,${i},60,2`).join("\n"),
    );
    expect(() => parseComputerFile(zipSync({ "one.csv": csv, "two.csv": csv }))).toThrow(
      "limit_exceeded",
    );
    const xml = new TextDecoder().decode(fixture("si.uddf"));
    const samples = Array.from(
      { length: 9090 },
      (_, i) => `<waypoint><divetime>${i / 10}</divetime><depth>0</depth></waypoint>`,
    ).join("");
    const manySamples = bytes(
      xml.replace(/<samples>[\s\S]*?<\/samples>/, `<samples>${samples}</samples>`),
    );
    expect(() =>
      parseComputerFile(
        zipSync(
          Object.fromEntries(Array.from({ length: 11 }, (_, i) => [`${i}.uddf`, manySamples])),
        ),
      ),
    ).not.toThrow();
    expect(() =>
      parseComputerFile(
        zipSync(
          Object.fromEntries(Array.from({ length: 12 }, (_, i) => [`${i}.uddf`, manySamples])),
        ),
      ),
    ).toThrow("limit_exceeded");
  });
});
