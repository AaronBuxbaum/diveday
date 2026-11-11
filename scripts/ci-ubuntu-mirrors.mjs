// Keep CI's Ubuntu package downloads off the repeatedly failing Azure mirror,
// but only when the runner already supplies the official archive alternative.
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const AZURE = new Set([
  "http://azure.archive.ubuntu.com/ubuntu/",
  "https://azure.archive.ubuntu.com/ubuntu/",
]);
const ARCHIVE = new Set([
  "http://archive.ubuntu.com/ubuntu/",
  "https://archive.ubuntu.com/ubuntu/",
]);
const uri = (line) => line.trim().split(/\s+/, 1)[0];

/** Preserve every other line, including priorities, comments and line endings. */
export function preferOfficialArchive(contents) {
  const lines = contents.split(/(?<=\n)/);
  if (!lines.some((line) => ARCHIVE.has(uri(line)))) return contents;
  return lines.filter((line) => !AZURE.has(uri(line))).join("");
}

export function prepareUbuntuMirrors(file = "/etc/apt/apt-mirrors.txt") {
  let before;
  try {
    before = readFileSync(file, "utf8");
  } catch (error) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
  const after = preferOfficialArchive(before);
  if (after === before) return false;
  writeFileSync(file, after);
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (prepareUbuntuMirrors())
    console.log("CI apt: using the runner's existing official Ubuntu archive mirror.");
}
