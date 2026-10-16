import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * Git merge drivers for the files this repo generates, so a merge never stops on them.
 *
 * Restacking merges every layer into the one above, and on 2026-10-05..12 the files that
 * conflicted most were not anyone's code: `scripts/ratchets.json` (30 merges),
 * `src/db/__snapshots__/export-bundle.shop.snap` (10), the generated glossary and ADR indexes.
 * Each stop cost a session a conflict read, a hand resolution and often a red CI round. Every
 * one of these files is rewritten by a command, so the right resolution is mechanical:
 *
 * - `diveday-ratchets` merges `scripts/ratchets.json` as JSON, key by key. A count both sides
 *   moved takes the larger, which no guard can refuse as growth; `pnpm regen` then banks the
 *   true number. Absorb logs are unioned, so neither side's recorded reason is lost.
 * - `diveday-durations` merges `scripts/test-durations.json` (path → milliseconds) the same way
 *   and writes it in `merge-test-durations.mjs`'s code-unit key order, so a merge does not
 *   reorder the file. It had no driver until 2026-10-13, when two layer merges stopped on it.
 * - `diveday-generated` merges line by line and settles a clashing hunk with our side
 *   (`git merge-file --ours`); `pnpm regen` rewrites the file from its sources.
 *
 * `.gitattributes` names the files. Git only runs a driver its config defines, so
 * `node scripts/merge-drivers.mjs install` writes the definitions into `.git/config`; the
 * `SessionStart` hook runs it for every session, and a human runs it once per clone.
 */

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export const DRIVERS = {
  "diveday-ratchets": {
    name: "DiveDay ratchet counts (larger count wins; pnpm regen banks the truth)",
    driver: "node scripts/merge-drivers.mjs ratchets %O %A %B %P",
  },
  "diveday-durations": {
    name: "DiveDay test durations (larger duration wins; the next refresh measures again)",
    driver: "node scripts/merge-drivers.mjs durations %O %A %B %P",
  },
  "diveday-generated": {
    name: "DiveDay generated file (our side on a clash; pnpm regen rewrites it)",
    driver: "node scripts/merge-drivers.mjs generated %O %A %B %P",
  },
};

const isObject = (value) => value !== null && typeof value === "object" && !Array.isArray(value);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** Three-way merge of one JSON value. Keys keep our order, then theirs' new keys. */
export function mergeJson(base, ours, theirs) {
  if (same(ours, theirs)) return ours;
  if (same(base, ours)) return theirs;
  if (same(base, theirs)) return ours;
  if (typeof ours === "number" && typeof theirs === "number") return Math.max(ours, theirs);
  if (Array.isArray(ours) && Array.isArray(theirs)) {
    const seen = new Set(ours.map((item) => JSON.stringify(item)));
    return [...ours, ...theirs.filter((item) => !seen.has(JSON.stringify(item)))];
  }
  if (isObject(ours) && isObject(theirs)) {
    const from = isObject(base) ? base : {};
    const merged = {};
    for (const key of new Set([...Object.keys(ours), ...Object.keys(theirs)])) {
      const inOurs = key in ours;
      const inTheirs = key in theirs;
      if (inOurs && inTheirs) merged[key] = mergeJson(from[key], ours[key], theirs[key]);
      // One side deleted the key: keep the deletion unless the other side changed it.
      else if (inOurs) {
        if (!(key in from) || !same(from[key], ours[key])) merged[key] = ours[key];
      } else if (!(key in from) || !same(from[key], theirs[key])) merged[key] = theirs[key];
    }
    return merged;
  }
  return ours;
}

/** The ratchet file merged, in the shape `writeRatchet` writes. */
export function mergeRatchetText(baseText, oursText, theirsText) {
  const parse = (text) => {
    try {
      return JSON.parse(text);
    } catch {
      return {};
    }
  };
  const merged = mergeJson(parse(baseText), JSON.parse(oursText), JSON.parse(theirsText));
  const { "//": note, ...guards } = merged;
  const ordered = {
    ...(note === undefined ? {} : { "//": note }),
    ...Object.fromEntries(Object.entries(guards).sort(([a], [b]) => a.localeCompare(b))),
  };
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

/** The durations file merged, in the shape `merge-test-durations.mjs` writes. */
export function mergeDurationsText(baseText, oursText, theirsText) {
  let base = {};
  try {
    base = JSON.parse(baseText);
  } catch {
    // No common ancestor: both sides are new.
  }
  const merged = mergeJson(base, JSON.parse(oursText), JSON.parse(theirsText));
  const ordered = Object.fromEntries(
    Object.entries(merged).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)),
  );
  return `${JSON.stringify(ordered, null, 2)}\n`;
}

const NOTE = (file) =>
  `merge-drivers: ${file} merged mechanically; run \`pnpm regen\` before you commit the merge.`;

function ratchets([base, ours, theirs, file]) {
  try {
    const text = mergeRatchetText(
      readFileSync(base, "utf8"),
      readFileSync(ours, "utf8"),
      readFileSync(theirs, "utf8"),
    );
    writeFileSync(ours, text);
  } catch {
    // Unparseable on one side: fall back to a line merge that settles clashes our way.
    return generated([base, ours, theirs, file]);
  }
  console.error(NOTE(file));
  return 0;
}

function durations([base, ours, theirs, file]) {
  try {
    writeFileSync(
      ours,
      mergeDurationsText(
        readFileSync(base, "utf8"),
        readFileSync(ours, "utf8"),
        readFileSync(theirs, "utf8"),
      ),
    );
  } catch {
    return generated([base, ours, theirs, file]);
  }
  return 0;
}

function generated([base, ours, theirs, file]) {
  const result = runBounded("git", ["merge-file", "--ours", ours, base, theirs], {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  if (result.status !== 0) return 1;
  console.error(NOTE(file));
  return 0;
}

/**
 * The git runner `install` uses: `(args) => { status, stdout }`. Injectable so the tests can
 * count writes without a repository.
 */
function gitRunner(cwd) {
  return (args) =>
    runBounded("git", args, { cwd, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.git });
}

/**
 * Writes the driver definitions into this clone's git config, and returns whether they are
 * there afterwards. Idempotent, and reads before it writes.
 *
 * Every session start calls this. In a linked worktree `--local` is the clone's one shared
 * `.git/config`, so parallel starts used to contend for `config.lock` with eight writes each;
 * the loser returned false, nobody read it, and its next restack stopped on `ratchets.json`
 * exactly as before the drivers existed (2026-10-13 re-review, item 20). Now a definition that
 * already reads back as wanted is not written at all, so the usual start writes nothing, and a
 * write that loses the race still counts as installed when the winner wrote the same value.
 */
export function install(cwd = ROOT, { git = gitRunner(cwd) } = {}) {
  const current = (key) => {
    const result = git(["config", "--local", "--get", key]);
    return result.status === 0 ? String(result.stdout ?? "").trim() : null;
  };
  for (const [id, { name, driver }] of Object.entries(DRIVERS)) {
    for (const [key, value] of [
      [`merge.${id}.name`, name],
      [`merge.${id}.driver`, driver],
    ]) {
      if (current(key) === value) continue;
      const result = git(["config", "--local", key, value]);
      if (result.status !== 0 && current(key) !== value) return false;
    }
  }
  return true;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2);
  if (command === "ratchets") process.exit(ratchets(args));
  if (command === "durations") process.exit(durations(args));
  if (command === "generated") process.exit(generated(args));
  if (command === "install") {
    const ok = install(process.cwd());
    console.log(ok ? "merge-drivers: installed in .git/config" : "merge-drivers: install failed");
    process.exit(ok ? 0 : 1);
  }
  console.error(
    "usage: node scripts/merge-drivers.mjs install | ratchets|durations|generated %O %A %B %P",
  );
  process.exit(2);
}
