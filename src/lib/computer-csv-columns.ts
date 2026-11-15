import Papa from "papaparse";

type HeaderRefusal = (code: "invalid_csv" | "file_too_large" | "invalid_encoding") => never;
const fail: HeaderRefusal = (code) => {
  throw new Error(code);
};

export function safeComputerCsvColumn(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.trim().length > 0 &&
    value.length <= 256 &&
    !Array.from(value).some(
      (character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127,
    ) &&
    !["__proto__", "constructor", "prototype"].includes(value.trim().toLowerCase())
  );
}
export function computerCsvColumns(text: string, reject: HeaderRefusal = fail): string[] {
  // The first record must finish inside this bound, including quoting overhead.
  const prefix = text.slice(0, 32768);
  const result = Papa.parse<string[]>(prefix, { delimiter: ",", preview: 1 });
  const fields = result.data[0];
  if (
    result.errors.length ||
    !fields ||
    fields.length > 64 ||
    fields.some((field) => !safeComputerCsvColumn(field)) ||
    new Set(fields.map((field) => field.normalize("NFKC").trim().toLowerCase())).size !==
      fields.length ||
    (text.length > prefix.length && result.meta.cursor >= prefix.length)
  )
    reject("invalid_csv");
  return fields;
}

/** Header grammar only: never load full file decoders or infer dates and units in the browser. */
export function inspectComputerCsvColumns(
  bytes: Uint8Array,
  maxBytes: number,
  reject: HeaderRefusal = fail,
): string[] {
  if (bytes.byteLength > maxBytes) reject("file_too_large");
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    return reject("invalid_encoding");
  }
  return computerCsvColumns(text, reject);
}
