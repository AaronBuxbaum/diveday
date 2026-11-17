import { createHash } from "node:crypto";
import { readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

/**
 * A drawn marketing screen is kept honest against the shipped screen it mirrors: when that
 * screen changes, its drawing is read again, and only then is the change accepted.
 *
 * "A mockup is a claim, so it mirrors a real screen element for element"
 * (docs/product/marketing.md). Until this guard that was a convention a reviewer had to
 * remember: the homepage walkthrough follows one diver through four of these drawings, and a
 * buyer who opens the demo and finds a different screen has caught the page in a claim.
 *
 * A mock's docblock names what it mirrors, one `@mirrors <path>` line per file, in
 * `src/components/Marketing*.tsx` above its `export function`. This guard keeps a fingerprint of each
 * named file in `scripts/mockup-mirrors.json` (the file's text with comments and whitespace
 * removed, so a reworded comment or a reformat does not count) and fails when the file no
 * longer matches it, naming the file and every drawing that mirrors it. The fix is to compare the
 * drawing against the new screen, change it if it differs, then pin the new fingerprint with
 * `node scripts/check-mockup-mirrors.mjs --accept`: the pin moving in the diff is the
 * reviewer's evidence that someone looked.
 *
 * A path that no longer exists fails too: the screen was renamed or deleted, and the drawing
 * names something that is not there.
 */

const ROOT = process.cwd();
const COMPONENTS = "src/components";
export const PIN_FILE = "scripts/mockup-mirrors.json";

/** The text a fingerprint is taken over: no comments, no whitespace. */
export function normalize(source) {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/(^|[^:"'`])\/\/[^\n]*/g, "$1")
    .replace(/\s+/g, "");
}

export function fingerprint(source) {
  return createHash("sha256").update(normalize(source)).digest("hex").slice(0, 16);
}

/** `{ path, mock }` for every `@mirrors` line, tied to the `export function` after its docblock. */
export function readMirrors(source) {
  const found = [];
  for (const block of source.matchAll(/\/\*\*([\s\S]*?)\*\/\s*export function (\w+)/g)) {
    for (const line of block[1].matchAll(/@mirrors\s+(\S+)/g)) {
      found.push({ path: line[1], mock: block[2] });
    }
  }
  return found;
}

/** The mocks that mirror each path: `Map<path, mock[]>`. */
export function mirrorsByPath(entries) {
  const byPath = new Map();
  for (const { path: file, mock } of entries) {
    byPath.set(file, [...(byPath.get(file) ?? []), mock]);
  }
  return byPath;
}

/** Findings for the current fingerprints against the pins: `string[]`, empty when all agree. */
export function compare(byPath, current, pins) {
  const problems = [];
  for (const [file, mocks] of byPath) {
    const who = mocks.join(", ");
    if (current[file] === undefined) {
      problems.push(
        `${file}: does not exist, but ${who} draw it. Rename the path or retire the drawing.`,
      );
    } else if (pins[file] === undefined) {
      problems.push(`${file}: mirrored by ${who} but not pinned yet.`);
    } else if (pins[file] !== current[file]) {
      problems.push(`${file}: changed since ${who} were last read against it.`);
    }
  }
  for (const file of Object.keys(pins)) {
    if (!byPath.has(file)) problems.push(`${file}: pinned, but no drawing names it any more.`);
  }
  return problems;
}

async function main() {
  const accept = process.argv.includes("--accept");
  const entries = [];
  for (const name of await readdir(path.join(ROOT, COMPONENTS))) {
    if (!/^Marketing.*\.tsx$/.test(name) || name.endsWith(".test.tsx")) continue;
    entries.push(...readMirrors(await readFile(path.join(ROOT, COMPONENTS, name), "utf8")));
  }
  const byPath = mirrorsByPath(entries);

  const current = {};
  for (const file of byPath.keys()) {
    try {
      current[file] = fingerprint(await readFile(path.join(ROOT, file), "utf8"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }

  if (accept) {
    const missing = [...byPath.keys()].filter((file) => current[file] === undefined);
    if (missing.length > 0) {
      console.error(
        `mockup-mirrors: cannot pin a path that does not exist:\n- ${missing.join("\n- ")}`,
      );
      process.exit(1);
    }
    const sorted = Object.fromEntries(
      Object.entries(current).sort(([a], [b]) => a.localeCompare(b)),
    );
    await writeFile(path.join(ROOT, PIN_FILE), `${JSON.stringify(sorted, null, 2)}\n`);
    console.log(
      `mockup-mirrors: pinned ${Object.keys(sorted).length} mirrored screens in ${PIN_FILE}`,
    );
    return;
  }

  let pins = {};
  try {
    pins = JSON.parse(await readFile(path.join(ROOT, PIN_FILE), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
  }

  const problems = compare(byPath, current, pins);
  if (problems.length > 0) {
    console.error(
      `mockup-mirrors: a shipped screen and its drawing may disagree:\n${problems.map((p) => `- ${p}`).join("\n")}`,
    );
    console.error(
      "Open the shipped screen and its drawing side by side (the drawing names the file in its `@mirrors` lines). Change the drawing wherever the screen now differs, in both locales. Then `node scripts/check-mockup-mirrors.mjs --accept` pins the new fingerprint; commit it with the drawing.",
    );
    process.exit(1);
  }
  console.log(`mockup-mirrors: ${byPath.size} mirrored screens match their pins`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  await main();
}
