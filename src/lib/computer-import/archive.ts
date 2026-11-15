import { createHash } from "node:crypto";
import { crc32, inflateRawSync } from "node:zlib";
import type { ComputerParseOptions } from "./options";
import { COMPUTER_IMPORT_LIMITS as LIMIT, type ParsedComputerDive, refuse } from "./types";

const ARCHIVE = { entries: 20, outputBytes: 10 * 1024 * 1024, ratio: 200 } as const;
type Entry = {
  name: string;
  directory: boolean;
  method: number;
  crc: number;
  compressed: number;
  size: number;
  dataStart: number;
  start: number;
  end: number;
};
const signature = (bytes: Uint8Array, at: number, value: number) =>
  at >= 0 &&
  at + 4 <= bytes.length &&
  new DataView(bytes.buffer, bytes.byteOffset + at, 4).getUint32(0, true) === value;
export function isComputerArchive(bytes: Uint8Array): boolean {
  return [0x04034b50, 0x06054b50, 0x08074b50].some((value) => signature(bytes, 0, value));
}
function safeName(raw: Uint8Array, utf8: boolean): string {
  if (raw.length === 0 || raw.length > 512 || (!utf8 && raw.some((byte) => byte > 127)))
    refuse("unsafe_archive");
  let name: string;
  try {
    name = new TextDecoder("utf-8", { fatal: true }).decode(raw);
  } catch {
    return refuse("unsafe_archive");
  }
  const parts = name.replace(/\/$/, "").split("/");
  const normalized = name.normalize("NFKC").replace(/\/$/, "").split("/");
  if (
    /[\\:]/.test(name) ||
    Array.from(name).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) ||
    parts.length > 8 ||
    parts.some((part) => !part || part === "." || part === ".." || part.trim() !== part) ||
    normalized.some((part) => !part || part === "." || part === "..") ||
    /\.(?:zip|zipx|rar|7z|tar|tgz|gz|bz2|xz|jar)$/i.test(name)
  )
    refuse("unsafe_archive");
  return name;
}
function checkExtra(bytes: Uint8Array, start: number, length: number) {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let offset = start;
  while (offset < start + length) {
    if (offset + 4 > start + length) refuse("invalid_archive");
    const kind = view.getUint16(offset, true);
    const size = view.getUint16(offset + 2, true);
    // ZIP64 and alternate Unicode paths could change the bounds/name interpretation.
    if (kind === 1 || kind === 0x7075) refuse("unsafe_archive");
    offset += 4 + size;
    if (offset > start + length) refuse("invalid_archive");
  }
}

/** Read a strict, single-volume ZIP entirely in memory, validating metadata before inflation. */
function entries(bytes: Uint8Array): Entry[] {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let eocd = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (
      signature(bytes, at, 0x06054b50) &&
      at + 22 + view.getUint16(at + 20, true) === bytes.length
    ) {
      eocd = at;
      break;
    }
  }
  if (eocd < 0) refuse("invalid_archive");
  const count = view.getUint16(eocd + 10, true);
  const centralSize = view.getUint32(eocd + 12, true);
  const centralStart = view.getUint32(eocd + 16, true);
  if (
    view.getUint16(eocd + 4, true) !== 0 ||
    view.getUint16(eocd + 6, true) !== 0 ||
    view.getUint16(eocd + 8, true) !== count ||
    count === 0xffff ||
    centralSize === 0xffffffff ||
    centralStart === 0xffffffff ||
    signature(bytes, eocd - 20, 0x07064b50)
  )
    refuse("unsafe_archive");
  if (count > ARCHIVE.entries) refuse("archive_limit_exceeded");
  if (centralStart + centralSize !== eocd) refuse("invalid_archive");
  const result: Entry[] = [];
  const names = new Set<string>();
  let offset = centralStart;
  let declaredTotal = 0;
  for (let i = 0; i < count; i++) {
    if (offset + 46 > eocd || !signature(bytes, offset, 0x02014b50)) refuse("invalid_archive");
    const version = view.getUint16(offset + 6, true);
    const flags = view.getUint16(offset + 8, true);
    const method = view.getUint16(offset + 10, true);
    const crc = view.getUint32(offset + 16, true);
    const compressed = view.getUint32(offset + 20, true);
    const size = view.getUint32(offset + 24, true);
    const nameLength = view.getUint16(offset + 28, true);
    const extraLength = view.getUint16(offset + 30, true);
    const commentLength = view.getUint16(offset + 32, true);
    const disk = view.getUint16(offset + 34, true);
    const attributes = view.getUint32(offset + 38, true);
    const start = view.getUint32(offset + 42, true);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > eocd || start + 30 > centralStart) refuse("invalid_archive");
    if (version > 20 || flags & ~0x080e || disk !== 0 || (method !== 0 && method !== 8))
      refuse("unsafe_archive");
    if ([compressed, size, start].includes(0xffffffff)) refuse("unsafe_archive");
    const mode = (attributes >>> 16) & 0xf000;
    if (mode !== 0 && mode !== 0x8000 && mode !== 0x4000) refuse("unsafe_archive");
    const rawName = bytes.subarray(offset + 46, offset + 46 + nameLength);
    const name = safeName(rawName, Boolean(flags & 0x0800));
    const key = name.normalize("NFKC").toLowerCase().replace(/\/$/, "");
    if (names.has(key)) refuse("unsafe_archive");
    names.add(key);
    checkExtra(bytes, offset + 46 + nameLength, extraLength);
    const directory = name.endsWith("/");
    if ((mode === 0x4000 && !directory) || (directory && size !== 0)) refuse("unsafe_archive");
    declaredTotal += size;
    if (
      size > LIMIT.fileBytes ||
      declaredTotal > ARCHIVE.outputBytes ||
      size > Math.max(1024, compressed * ARCHIVE.ratio)
    )
      refuse("archive_limit_exceeded");
    if (!signature(bytes, start, 0x04034b50)) refuse("invalid_archive");
    const localFlags = view.getUint16(start + 6, true);
    const localNameLength = view.getUint16(start + 26, true);
    const localExtraLength = view.getUint16(start + 28, true);
    const dataStart = start + 30 + localNameLength + localExtraLength;
    if (
      dataStart + compressed > centralStart ||
      view.getUint16(start + 4, true) !== version ||
      localFlags !== flags ||
      view.getUint16(start + 8, true) !== method ||
      localNameLength !== nameLength ||
      bytes
        .subarray(start + 30, start + 30 + localNameLength)
        .some((byte, n) => byte !== rawName[n])
    )
      refuse("invalid_archive");
    checkExtra(bytes, start + 30 + localNameLength, localExtraLength);
    const descriptor = Boolean(flags & 8);
    for (const [field, expected] of [
      [14, crc],
      [18, compressed],
      [22, size],
    ] as const) {
      const actual = view.getUint32(start + field, true);
      if (actual !== expected && !(descriptor && actual === 0)) refuse("invalid_archive");
    }
    let end = dataStart + compressed;
    if (descriptor) {
      if (signature(bytes, end, 0x08074b50)) end += 4;
      if (
        end + 12 > centralStart ||
        view.getUint32(end, true) !== crc ||
        view.getUint32(end + 4, true) !== compressed ||
        view.getUint32(end + 8, true) !== size
      )
        refuse("invalid_archive");
      end += 12;
    }
    result.push({ name, directory, method, crc, compressed, size, dataStart, start, end });
    offset = next;
  }
  if (offset !== eocd) refuse("invalid_archive");
  const ordered = [...result].sort((a, b) => a.start - b.start);
  let localEnd = 0;
  for (const entry of ordered) {
    if (entry.start !== localEnd) refuse("invalid_archive");
    localEnd = entry.end;
  }
  if (localEnd !== centralStart) refuse("invalid_archive");
  return result;
}

export function parseComputerArchive(
  bytes: Uint8Array,
  options: ComputerParseOptions,
  parseEntry: (bytes: Uint8Array, options: ComputerParseOptions) => ParsedComputerDive[],
): ParsedComputerDive[] {
  if (bytes.byteLength > LIMIT.fileBytes) refuse("file_too_large");
  const metadata = entries(bytes);
  const dives: ParsedComputerDive[] = [];
  let totalOutput = 0;
  let totalSamples = 0;
  let ignored = 0;
  for (const entry of metadata) {
    const compressed = bytes.subarray(entry.dataStart, entry.dataStart + entry.compressed);
    let content: Uint8Array;
    if (entry.method === 0) content = compressed;
    else {
      try {
        // Node bounds actual output even if all declared sizes and ratios were forged.
        const inflated = inflateRawSync(compressed, {
          maxOutputLength: Math.max(
            1,
            Math.min(LIMIT.fileBytes, ARCHIVE.outputBytes - totalOutput),
          ),
          info: true,
        }) as unknown as { buffer: Uint8Array; engine: { bytesWritten: number } };
        content = inflated.buffer;
        if (inflated.engine.bytesWritten !== compressed.length) refuse("invalid_archive");
      } catch (error) {
        if (error instanceof Error && "code" in error && error.code === "ERR_BUFFER_TOO_LARGE")
          refuse("archive_limit_exceeded");
        return refuse("invalid_archive");
      }
    }
    totalOutput += content.byteLength;
    if (content.byteLength > LIMIT.fileBytes || totalOutput > ARCHIVE.outputBytes)
      refuse("archive_limit_exceeded");
    if (content.byteLength !== entry.size || crc32(content) !== entry.crc)
      refuse("invalid_archive");
    if (entry.directory) continue;
    if (isComputerArchive(content) || (content[0] === 0x1f && content[1] === 0x8b))
      refuse("unsafe_archive");
    if (!/\.(?:uddf|xml|csv|fit)$/i.test(entry.name)) {
      ignored++;
      continue;
    }
    const parsed = parseEntry(content, options);
    const hash = createHash("sha256").update(content).digest("hex");
    for (const [index, dive] of parsed.entries()) {
      totalSamples += dive.samples.length;
      if (dives.length >= LIMIT.dives || totalSamples > LIMIT.samplesPerFile)
        refuse("limit_exceeded");
      dives.push({
        ...dive,
        archiveEntry: entry.name,
        archiveEntryHash: hash,
        archiveEntryRecordIndex: index,
      });
    }
  }
  return dives.map((dive) => ({ ...dive, archiveIgnoredEntries: ignored }));
}
