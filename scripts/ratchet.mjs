import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";

/**
 * Every ratcheted guard's numbers, in one file keyed by guard name.
 *
 * These were ten three-line `scripts/<guard>-baseline.json` files, each read, written and
 * absorbed by its own copy of the same forty lines. One file means one place to look when a
 * guard says "lower the baseline", and one shared answer to how `--write` and `--absorb`
 * behave. `route-coverage.json` and `image-sizes.json` stay separate: they are data a guard
 * checks against, not counters that only fall.
 */
export const RATCHETS_PATH = "scripts/ratchets.json";

const NOTE =
  'Every ratcheted check:repo guard\'s counts, keyed by guard. A count may only fall: `node scripts/check-<guard>.mjs --write` banks a fall and refuses a rise; `--absorb "<why>"` records a deliberate rise with its reason. Shared code: scripts/ratchet.mjs.';

async function readAll(root) {
  try {
    return JSON.parse(await readFile(path.join(root, RATCHETS_PATH), "utf8"));
  } catch (error) {
    if (error?.code !== "ENOENT") throw error;
    return {};
  }
}

/** One guard's section of the ratchet file, or `undefined` when it has none yet. */
export async function readRatchet(root, guard) {
  return (await readAll(root))[guard];
}

/** Replaces one guard's section and leaves every other guard's untouched. */
export async function writeRatchet(root, guard, section) {
  const all = await readAll(root);
  all[guard] = section;
  const { "//": _note, ...guards } = all;
  const ordered = {
    "//": NOTE,
    ...Object.fromEntries(Object.entries(guards).sort(([a], [b]) => a.localeCompare(b))),
  };
  await writeFile(path.join(root, RATCHETS_PATH), `${JSON.stringify(ordered, null, 2)}\n`);
}

/**
 * A per-file counter guard's allowance: `{ counts, exists }`. Keys beginning `//` carry notes
 * and the absorb log for humans; they are not paths. `exists` is false before the guard's
 * first `--write`, which a guard reads as "being set up", not as "everything grew".
 */
export async function readCounts(root, guard) {
  const section = await readRatchet(root, guard);
  if (section === undefined) return { counts: {}, exists: false };
  return {
    counts: Object.fromEntries(Object.entries(section).filter(([key]) => !key.startsWith("//"))),
    exists: true,
  };
}

/**
 * What this run was asked to do to the ratchet. `absorb` is `null` when `--absorb` was not
 * passed, and otherwise the reason that followed it (`""` when none did, which `bankCounts`
 * refuses: the reason is what a reader sees in the diff when a number rises).
 */
export function ratchetFlags(argv = process.argv) {
  const at = argv.indexOf("--absorb");
  const next = at === -1 ? undefined : argv[at + 1];
  return {
    write: argv.includes("--write"),
    absorb: at === -1 ? null : next && !next.startsWith("--") ? next : "",
  };
}

/** `[file, count]` pairs, sorted; a value may be the count or the list of hits it counts. */
const sortedEntries = (counts) =>
  [...(counts instanceof Map ? counts.entries() : Object.entries(counts))]
    .map(([file, value]) => [file, typeof value === "number" ? value : value.length])
    .sort(([a], [b]) => a.localeCompare(b));

/**
 * `--write` / `--absorb` for a per-file counter guard. Returns the exit code.
 *
 * `--write` banks the current counts and refuses any that rose, printing `refusal` (the
 * guard's own sentence saying what to do instead). `--absorb "<why>"` is `--write` for growth that arrived in a merge from a branch
 * that predates the guard: it prints every increase it accepts and appends `{ why, files }`
 * to the section's `//absorbed` log, so the rise and its reason are in the diff.
 */
export async function bankCounts({
  root,
  guard,
  counts,
  allowed,
  exists,
  note,
  refusal,
  absorb,
  summary,
}) {
  const entries = sortedEntries(counts);
  const grew = exists ? entries.filter(([file, count]) => count > (allowed[file] ?? 0)) : [];
  const describe = ([file, count]) =>
    file in allowed
      ? `- ${file}: ${allowed[file]} → ${count}`
      : `- ${file}: new file with ${count}`;
  const previous = (await readRatchet(root, guard)) ?? {};
  let absorbed = previous["//absorbed"] ?? [];

  if (grew.length > 0) {
    if (absorb === null) {
      console.error(`Refusing to write a baseline that grows. ${refusal}:`);
      for (const entry of grew) console.error(describe(entry));
      console.error(
        `If this growth arrived in a merge from a branch that predates the check, \`node scripts/check-${guard}.mjs --absorb "<why>"\` records it explicitly.`,
      );
      return 1;
    }
    if (absorb === "") {
      console.error(
        `${guard}: --absorb needs a reason — \`--absorb "merged #1234, which predates the check"\`. The reason is what a reader sees in the diff when the number rises.`,
      );
      return 1;
    }
    console.warn(`Absorbing growth (${absorb}) — this must be merged-in work, not new debt:`);
    for (const entry of grew) console.warn(describe(entry));
    absorbed = [
      ...absorbed,
      {
        why: absorb,
        files: Object.fromEntries(
          grew.map(([file, count]) => [file, `${allowed[file] ?? 0} -> ${count}`]),
        ),
      },
    ];
  }

  await writeRatchet(root, guard, {
    "//": note,
    ...(absorbed.length > 0 ? { "//absorbed": absorbed } : {}),
    ...Object.fromEntries(entries),
  });
  const total = entries.reduce((sum, [, count]) => sum + count, 0);
  console.log(`${guard}: baseline written — ${summary(entries.length, total)}`);
  return 0;
}
