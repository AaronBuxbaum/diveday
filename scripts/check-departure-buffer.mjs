import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * Every "has it sailed / is it back" question goes through `hasSailed()` /
 * `hasReturned()` (`src/lib/trips.ts`), and the hour of grace is spelled once.
 *
 * Trips run late, so AGENTS.md carries a hard rule: every check deciding
 * whether a departure has sailed, ended, or is "in the past" allows an hour
 * past the scheduled time first. Booking eligibility, walk-in check-ins,
 * blowout alternatives, close-out state, sitemap and stats visibility — the
 * rule names six surfaces, and it was written in prose.
 *
 * Prose is what it stayed. When this script was written the hour was spelled
 * **fifteen** times — nine private `const … = 60 * 60 * 1000` declarations and
 * six bare literals compared inline — across three different predicate names
 * (`hasDeparted`, `bookingIsAhead`, and closeout's own inline checks). Two of
 * them disagreed at the boundary millisecond. Every one of the nine constants
 * carried a docstring citing the rule, and each cited a *different* sibling as
 * the authority, in a ring with no centre. The shared one claimed it existed
 * "in one place rather than four literals".
 *
 * That is the tell: a rule enforced by a sentence drifts one call site at a
 * time, and each new site copies whichever neighbour the author happened to
 * read. Every copy was correct on the day it was written. The exposure is the
 * *next* edit, which reaches one of fifteen.
 *
 * **The failure is quiet and it is customer-facing.** A site that forgets the
 * buffer does not throw and does not look wrong in review — it tells a diver
 * standing on the dock at 07:05 that the 07:00 boat they are waiting to board
 * is in their history, or refuses a walk-in the desk would happily have taken.
 * Nothing fails; the answer is just wrong for an hour, once per departure.
 *
 * ## What is guarded
 *
 * Two shapes, in non-test sources under {@link GUARDED_ROOTS}:
 *
 * 1. **A hand-rolled comparison** — an offset added to a `startsAt`/`endsAt`
 *    on a line that also compares (`<`, `>`, `<=`, `>=`). Construction is left
 *    alone: the seeds build dates from a departure all day long
 *    (`new Date(trip.startsAt.getTime() + index * step)`) and answer no
 *    question about the clock, which is why the comparison operator is the
 *    anchor rather than the arithmetic.
 * 2. **A second name for the constant** — any `*_BUFFER_MS` declared outside
 *    `src/lib/trips.ts`. This is the half that actually rotted: all nine
 *    private constants were correct on the day they were written and carried a
 *    docstring citing AGENTS.md, and all nine were still forks. A guard that
 *    only caught bare literals would have passed the tree as it stood.
 *
 * ## Saying "this offset is not that question"
 *
 * Put `diveday:allow-departure-offset: <why>` in a comment on the line or
 * just above it. There is one such case today and it is the honest kind: the
 * recap's own delay (`src/lib/thread-steps.ts`) waits its scheduled hours
 * after a boat this rule has already counted as home, so it is a different
 * clock that happens to be measured from the same column.
 */

const ROOT = process.cwd();
const GUARDED_ROOTS = ["src/app", "src/components", "src/db", "src/features", "src/lib"];
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx"]);

/**
 * The one file allowed to say what the buffer is. `hasSailed`/`hasReturned`
 * live beside it, so a reader who finds the constant finds the predicates.
 */
const HOME = path.normalize("src/lib/trips.ts");

/** An offset added to a departure column: `trip.startsAt.getTime() + <x>`. */
const OFFSET = /\b(?:startsAt|endsAt|starts_at|ends_at)\b[^\n]{0,40}\.getTime\(\)\s*\+/;

/**
 * A comparison on the same line. `=>` is excluded deliberately — an arrow
 * function is not a comparison, and `(t) => new Date(t.startsAt.getTime() + n)`
 * is ordinary construction inside a `.map`.
 */
const COMPARISON = /(?:<=|>=|(?<![=!<>-])<(?!=)|(?<![=!<>-])>(?!=))/;

/** A second spelling of the constant, anywhere but its home. */
const REDECLARED = /\b(?:const|let|var)\s+([A-Z0-9_]*BUFFER_MS)\b/;

const ALLOW = /diveday:allow-departure-offset:/;
const IS_TEST = /\.test\.tsx?$/;
const COMMENT = /^\s*(?:\/\/|\/\*|\*)/;

/**
 * Whether a line carries the exemption, or sits under a comment block that
 * does. The whole block counts, not just the line above: the one real
 * exemption in the tree needs three lines to say why, and a rule that only
 * reads the last of them would push the reason onto one long line — which is
 * how an exemption stops explaining itself and becomes a token people copy.
 */
function isAllowed(lines, index) {
  if (ALLOW.test(lines[index])) return true;
  for (let above = index - 1; above >= 0 && COMMENT.test(lines[above]); above -= 1) {
    if (ALLOW.test(lines[above])) return true;
  }
  return false;
}

/**
 * Files that legitimately measure from a departure without asking this
 * question. The seeds *write* the board rather than reading it — every date in
 * them is constructed, and a per-line comment would be forty copies of one
 * sentence — and `demo-refresh` slides a whole fixture forward in time.
 */
const SKIPPED_FILES = new Set([path.normalize("src/db/demo-refresh.ts")]);

/**
 * Both rules over one source. Returns findings with the 1-indexed line and the
 * offending text, plus how many lines were examined, so a passing run can say
 * what it actually looked at rather than only that it found nothing.
 */
export function findUnbufferedDepartureChecks(source, { isHome = false } = {}) {
  const lines = source.split("\n");
  const findings = [];
  let checked = 0;

  for (const [index, line] of lines.entries()) {
    if (isAllowed(lines, index)) continue;

    const redeclared = REDECLARED.exec(line);
    if (redeclared && !isHome) {
      findings.push({ line: index + 1, text: line.trim(), rule: "redeclared" });
      continue;
    }

    if (!OFFSET.test(line)) continue;
    checked += 1;
    if (isHome) continue;
    if (!COMPARISON.test(line)) continue;
    findings.push({ line: index + 1, text: line.trim(), rule: "comparison" });
  }

  return { findings, checked };
}

async function walk(relativeDirectory) {
  const absolute = path.join(ROOT, relativeDirectory);
  const entries = await readdir(absolute, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    const relative = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walk(relative)));
      continue;
    }
    if (SOURCE_EXTENSIONS.has(path.extname(entry.name))) files.push(relative);
  }
  return files;
}

async function main() {
  const violations = [];
  let checked = 0;

  for (const root of GUARDED_ROOTS) {
    for (const file of await walk(root)) {
      const normalized = path.normalize(file);
      if (SKIPPED_FILES.has(normalized) || IS_TEST.test(file)) continue;
      if (path.basename(file).startsWith("seed-")) continue;
      const source = await readFile(path.join(ROOT, file), "utf8");
      const result = findUnbufferedDepartureChecks(source, { isHome: normalized === HOME });
      checked += result.checked;
      for (const finding of result.findings) {
        violations.push(`${file}:${finding.line}: ${finding.text}`);
      }
    }
  }

  if (violations.length > 0) {
    console.error(
      `Departure checks that spell the late-arrival buffer themselves:\n${violations
        .map((violation) => `- ${violation}`)
        .join("\n")}`,
    );
    console.error(
      "Use `hasSailed(startsAt, now)` or `hasReturned(endsAt, now)` from src/lib/trips.ts, and never a second `*_BUFFER_MS`. Trips run late: a check that forgets the hour of grace does not throw, it just tells a diver waiting on the dock that their boat is in the past.",
    );
    console.error(
      "An offset that genuinely asks a different question (the recap delay, say) says `diveday:allow-departure-offset: <why>` on the line or just above it.",
    );
    process.exit(1);
  }

  console.log(
    `departure-buffer: ${checked} offsets from a departure all go through hasSailed/hasReturned (or say why they don't)`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
