// Renames numbered human-decision ids (H-07) to date-slug ids (H-20260724-payment-deposit-…)
// everywhere: the decision files, their headings, and every citation in every tracked text file.
//
//   node scripts/rename-human-decision-ids.mjs            apply
//   node scripts/rename-human-decision-ids.mjs --dry-run  report what would change
//
// It is safe to run again, and it has to be: a branch cut before the rename keeps adding
// numbered citations (and sometimes whole numbered decision files), so after merging one in,
// run this once more and commit what it changes. A number it has no decision for is reported
// and left, and `pnpm check:repo` then refuses it.
//
// `scripts/human-decision-ids.json` is the lookup: `ids` maps each old file stem to its new id
// (so a bare `H-49` and a stale link `H-49-we-carry-legacy-code-legacy.md` both resolve), and
// `slugs` holds the slugs chosen by hand where the old file name was a poor one. A numbered
// decision file not in `ids` is dated by the earliest date written in it (else the date it was
// first committed), named by the first four words of its old slug, and added to the lookup.
//
// The date is the day the call was made. A range ("H-27–H-30") becomes the list of its ids,
// because a date-slug id has no successor to count to.

import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { DECISIONS_DIR, decisionFileNames } from "./check-human-decisions.mjs";
import { readBounded, runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOOKUP = "scripts/human-decision-ids.json";
const SKIP_FILES = new Set([
  LOOKUP,
  "scripts/rename-human-decision-ids.mjs",
  "scripts/rename-human-decision-ids.test.mjs",
  "scripts/check-human-decisions.test.mjs",
]);
const SKIP_EXTENSIONS = /\.(png|jpe?g|gif|webp|avif|ico|woff2?|ttf|pdf|zip|gz|mp4|webm|mov|lock)$/i;
const SLUG_WORDS = 4;
const MAX_RANGE = 20;

const escapeRegExp = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const numberOf = (stem) => Number(stem.match(/^H-(\d{1,3})-/)?.[1]);
const slugOf = (stem) => stem.replace(/^H-\d{1,3}-/, "");

/** The id a numbered decision file gets: `H-YYYYMMDD-` and up to four words of its slug. */
export function deriveId(stem, contents, commitDate, taken, slugOverride = null) {
  const dates = [...contents.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g)]
    .filter((m) => m[0] >= "2026-06-01" && Number(m[2]) <= 12 && Number(m[3]) >= 1)
    .map((m) => m[0])
    .sort();
  const day = (dates[0] ?? commitDate).replaceAll("-", "");
  const words = (slugOverride ?? slugOf(stem)).split("-");
  for (let count = Math.min(SLUG_WORDS, words.length); count <= words.length; count += 1) {
    const id = `H-${day}-${words.slice(0, count).join("-")}`;
    if (!taken.has(id)) return id;
  }
  for (let n = 2; ; n += 1) {
    const id = `H-${day}-${words.join("-")}-${n}`;
    if (!taken.has(id)) return id;
  }
}

/**
 * `text` with every numbered id replaced. `ids` is number → new id; `stems` is old file stem →
 * new id. Returns `{ text, changed, unknown }`, `unknown` being numbers with no decision.
 */
export function renameText(text, ids, stems) {
  const unknown = [];
  let out = text;
  if (stems.size > 0) {
    const names = [...stems.keys()].sort((a, b) => b.length - a.length).map(escapeRegExp);
    out = out.replace(
      new RegExp(`(?<![A-Za-z0-9])(?:${names.join("|")})(?![a-z0-9-])`, "g"),
      (stem) => stems.get(stem),
    );
  }
  out = out.replace(
    /(?<![A-Za-z0-9])H-(\d{1,3})\s*(?:[–—…]\s*(?:H-)?|-H-)(\d{1,3})(?![0-9])/g,
    (whole, from, to) => {
      const [a, b] = [Number(from), Number(to)];
      if (a >= b || b - a > MAX_RANGE) return whole;
      const list = [];
      for (let n = a; n <= b; n += 1) if (ids.has(n)) list.push(ids.get(n));
      return list.length === b - a + 1 ? list.join(", ") : whole;
    },
  );
  out = out.replace(/(?<![A-Za-z0-9])H-(\d{1,3})(?![0-9])/g, (whole, number) => {
    const id = ids.get(Number(number));
    if (id) return id;
    unknown.push(Number(number));
    return whole;
  });
  return { text: out, changed: out !== text, unknown };
}

function git(args, options = {}) {
  return readBounded("git", args, {
    cwd: ROOT,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
    maxBuffer: 64 * 1024 * 1024,
    ...options,
  });
}

function firstCommitDate(file, today) {
  try {
    const days = git(["log", "--follow", "--format=%cs", "--", file]).trim().split("\n");
    return days.at(-1) || today;
  } catch {
    return today;
  }
}

function main() {
  const dryRun = process.argv.includes("--dry-run");
  const today = new Date().toISOString().slice(0, 10);
  const lookupPath = path.join(ROOT, LOOKUP);
  const lookup = JSON.parse(readFileSync(lookupPath, "utf8"));
  lookup.ids ??= {};
  lookup.slugs ??= {};
  const dir = path.join(ROOT, DECISIONS_DIR);

  const taken = new Set(Object.values(lookup.ids));
  const moves = [];
  for (const name of decisionFileNames(dir)) {
    const stem = name.replace(/\.md$/, "");
    if (!/^H-\d{1,3}-/.test(stem)) continue;
    if (!lookup.ids[stem]) {
      const file = `${DECISIONS_DIR}/${name}`;
      const contents = readFileSync(path.join(ROOT, file), "utf8");
      const id = deriveId(stem, contents, firstCommitDate(file, today), taken, lookup.slugs[stem]);
      lookup.ids[stem] = id;
      taken.add(id);
    }
    moves.push([stem, lookup.ids[stem]]);
  }

  const stems = new Map(Object.entries(lookup.ids));
  const ids = new Map([...stems].map(([stem, id]) => [numberOf(stem), id]));
  if (dryRun) {
    console.log(`rename-human-decision-ids: ${moves.length} decision files would move`);
  } else {
    for (const [stem, id] of moves) {
      const from = `${DECISIONS_DIR}/${stem}.md`;
      const to = `${DECISIONS_DIR}/${id}.md`;
      const moved = runBounded("git", ["mv", from, to], {
        cwd: ROOT,
        encoding: "utf8",
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
      });
      if (moved.status !== 0) throw new Error(`git mv ${from} failed: ${moved.stderr}`);
    }
    writeFileSync(lookupPath, `${JSON.stringify(lookup, null, 2)}\n`);
  }

  const listed = git(["ls-files", "-z", "--cached", "--others", "--exclude-standard"]);
  const files = [...new Set(listed.split("\0").filter(Boolean))];
  let changedFiles = 0;
  const unknown = new Map();
  for (const file of files) {
    if (SKIP_FILES.has(file) || SKIP_EXTENSIONS.test(file)) continue;
    const absolute = path.join(ROOT, file);
    let text;
    try {
      text = readFileSync(absolute, "utf8");
    } catch {
      continue;
    }
    if (text.includes("\0") || !text.includes("H-")) continue;
    const result = renameText(text, ids, stems);
    for (const number of result.unknown)
      unknown.set(number, [...(unknown.get(number) ?? []), file]);
    if (!result.changed) continue;
    changedFiles += 1;
    if (!dryRun) writeFileSync(absolute, result.text);
  }

  if (!dryRun) {
    const written = runBounded("node", ["scripts/check-human-decisions.mjs", "--write"], {
      cwd: ROOT,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
    });
    if (written.status !== 0) console.error(`${written.stdout ?? ""}${written.stderr ?? ""}`);
  }
  console.log(
    `rename-human-decision-ids: ${moves.length} files moved, ${changedFiles} files edited${dryRun ? " (dry run)" : ""}`,
  );
  for (const [number, where] of unknown) {
    console.error(`  H-${number} names no decision: ${[...new Set(where)].slice(0, 3).join(", ")}`);
  }
  process.exit(unknown.size > 0 ? 1 : 0);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
