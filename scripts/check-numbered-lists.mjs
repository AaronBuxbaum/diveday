import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * **No numbered-list styling** (Aaron, 2026-11-17). A column of 1 2 3 4 looks
 * clickable and is not truly ordered, so a list is bullets, plain sentences or
 * a heading per item. This refuses the browser's own numbering
 * (`list-decimal`, `list-[decimal]`, `list-style: decimal`) under `src/app` and
 * `src/components`. A semantic `<ol>` that draws no numerals (a timeline, a
 * week strip) is fine. A numeral that is the item's own data (a printed form's
 * question number, a roster row on a manifest) is written in the markup, not
 * generated here.
 */

const ROOT = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
const ROOTS = ["src/app", "src/components"];
const EXTENSIONS = new Set([".tsx", ".css"]);
const NUMBERED = /list-decimal|list-\[decimal\]|list-style(-type)?:\s*decimal/;

async function walk(dir) {
  const files = [];
  for (const entry of await readdir(path.join(ROOT, dir), { withFileTypes: true })) {
    const rel = path.join(dir, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(rel)));
    else if (EXTENSIONS.has(path.extname(entry.name)) && !/\.test\.tsx$/.test(entry.name))
      files.push(rel);
  }
  return files;
}

export function findNumberedLists(file, text) {
  return text
    .split("\n")
    .map((line, index) => ({ line, number: index + 1 }))
    .filter(({ line }) => NUMBERED.test(line) && !/^\s*(\*|\/\/|\{\/\*)/.test(line))
    .map(({ line, number }) => ({ file, line: number, text: line.trim() }));
}

async function main() {
  const violations = [];
  for (const root of ROOTS)
    for (const file of await walk(root))
      violations.push(...findNumberedLists(file, await readFile(path.join(ROOT, file), "utf8")));
  if (violations.length === 0) {
    console.log("check:numbered-lists: no list draws browser numerals.");
    return;
  }
  console.error(
    "check:numbered-lists: a list is bullets, plain sentences or a heading per item, never 1 2 3 4.\n",
  );
  for (const v of violations) console.error(`  ${v.file}:${v.line}  ${v.text}`);
  process.exitCode = 1;
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) await main();
