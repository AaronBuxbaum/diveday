import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";
import { bankCounts, ratchetFlags, readCounts } from "./ratchet.mjs";

/**
 * A read of `people` says whether it means removed people too.
 *
 * Removing a diver sets `people.deleted_at` rather than deleting the row
 * (`deleteDiver`, src/db/divers.ts), and a staff member who also dives holds
 * the `diver` role, so a removed person can still hold a staff role. A read
 * that forgets the filter does not throw: the 2026-10-11 review found the
 * staff list behind every crew picker, the crew-change eligibility read and
 * sign-in all admitting a removed person. `livePerson()` (src/db/trips-live.ts)
 * is the predicate, the `liveTrip()` of this table.
 *
 * ## What is guarded
 *
 * Every `.from(people)` outside tests and seeds. It passes when, inside the
 * query (up to {@link QUERY_WINDOW} lines, and never past the next
 * `.from(people)`, the lesson `check-live-trips.mjs` learned in issue #635),
 * it carries `livePerson()`, the same clause spelled out as
 * `isNull(people.deletedAt)` (src/lib takes only types from src/db, so it
 * cannot import the predicate), or `diveday:allow-deleted-people: <why>` in a
 * comment.
 *
 * ## The baseline
 *
 * Unlike `trips`, most unfiltered reads of `people` are right as they are: a
 * by-id read inside a transaction that already proved the person, or a name
 * looked up for an activity line, where a removed person's name is the true
 * answer. Annotating sixty of those in one change would bury the few that
 * matter, so the reads written before this guard are counted per file in
 * `scripts/ratchets.json` ("live-people"). A count may only fall
 * (`node scripts/check-live-people.mjs --write`); a new unfiltered read in any
 * file fails until it filters or says why it does not.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/db", "src/lib", "src/features", "src/app"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);
const IS_TEST = /\.test\.tsx?$/;
const QUERY_WINDOW = 60;
const ANCHOR = /\.from\(people\)/;
const FILTERED = /livePerson\(\)|isNull\(people\.deletedAt\)|diveday:allow-deleted-people:/;
const GUARD = "live-people";

async function walk(relativeDirectory) {
  let entries;
  try {
    entries = await readdir(path.join(ROOT, relativeDirectory), { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relativePath);
  }
  return files;
}

/** Every `.from(people)` in one source, and which of them say nothing about removed people. */
export function findUnfilteredPeopleReads(source) {
  const lines = source.split("\n");
  const anchors = [];
  lines.forEach((line, index) => {
    if (ANCHOR.test(line)) anchors.push(index);
  });
  const findings = [];
  anchors.forEach((index, position) => {
    const end = Math.min(index + QUERY_WINDOW, anchors[position + 1] ?? lines.length);
    // A filter written *above* the anchor (a `.where` built first and passed
    // in) is not looked for: the query must say it where it reads the table.
    const window = lines.slice(index, end).join("\n");
    if (FILTERED.test(window)) return;
    findings.push({ line: index + 1, text: lines[index].trim() });
  });
  return { guarded: anchors.length, findings };
}

async function collect() {
  const counts = new Map();
  let guarded = 0;
  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      if (IS_TEST.test(file)) continue;
      const base = path.basename(file);
      if (base === "seed.ts" || base.startsWith("seed-")) continue;
      const result = findUnfilteredPeopleReads(await readFile(path.join(ROOT, file), "utf8"));
      guarded += result.guarded;
      if (result.findings.length > 0) {
        counts.set(
          file.split(path.sep).join("/"),
          result.findings.map((finding) => `${finding.line}: ${finding.text}`),
        );
      }
    }
  }
  return { counts, guarded };
}

/** Files over their allowance, files under it, and files the baseline no longer needs. */
export function auditPeopleBaseline(counts, allowed) {
  const failures = [];
  for (const [file, hits] of counts) {
    const allowance = allowed[file] ?? 0;
    if (hits.length > allowance) {
      failures.push(
        `${file}: ${hits.length} unfiltered reads of people, baseline allows ${allowance}:\n${hits.map((hit) => `    ${hit}`).join("\n")}`,
      );
    } else if (hits.length < allowance) {
      failures.push(
        `${file}: down to ${hits.length} from ${allowance} — lower the baseline in this change (\`node scripts/check-live-people.mjs --write\`).`,
      );
    }
  }
  for (const file of Object.keys(allowed)) {
    if (!counts.has(file)) {
      failures.push(
        `${file}: clean or gone — remove its baseline entry (\`node scripts/check-live-people.mjs --write\`).`,
      );
    }
  }
  return failures;
}

async function main() {
  const { counts, guarded } = await collect();
  const { counts: allowed, exists } = await readCounts(ROOT, GUARD);
  const { write, absorb } = ratchetFlags();
  if (write || absorb !== null) {
    process.exit(
      await bankCounts({
        root: ROOT,
        guard: GUARD,
        counts,
        allowed,
        exists,
        note: "Reads of `people` written before scripts/check-live-people.mjs that carry no `livePerson()`, per file. Most are right (a by-id read in a transaction, a name for an activity line); a count may only fall. Written by `node scripts/check-live-people.mjs --write`.",
        refusal:
          "Filter the new read with livePerson() or say `diveday:allow-deleted-people: <why>` in it",
        absorb,
        summary: (files, total) => `${files} files, ${total} unfiltered reads of people`,
      }),
    );
  }
  const failures = auditPeopleBaseline(counts, allowed);
  if (failures.length > 0) {
    console.error(
      `Reads of \`people\` that would include a removed person:\n${failures.map((item) => `- ${item}`).join("\n")}`,
    );
    console.error(
      "Add `livePerson()` (src/db/trips-live.ts) to the query's where clause, or `isNull(people.deletedAt)` under src/lib. Removing a diver sets `people.deleted_at` and leaves the row, and a removed staff member who also dives still holds a staff role. A read that genuinely means removed people too (a by-id read that already proved the person, a name for an activity line, the export bundle) says `diveday:allow-deleted-people: <why>` in a comment inside the query.",
    );
    process.exit(1);
  }
  const unfiltered = [...counts.values()].reduce((sum, hits) => sum + hits.length, 0);
  console.log(
    `live-people: ${guarded} reads of people; ${unfiltered} unfiltered, all in the baseline (it may only fall)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
