import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

/**
 * E2E specs may not paper over a race — they must wait for the thing the page
 * itself renders when the awaited work is done.
 *
 * Why this is a guarded invariant, not a style nit: this suite runs with
 * `retries: 0` (playwright.config.ts) precisely so a flake fails loudly and
 * gets root-caused. The failure mode this check exists for is not hypothetical;
 * it is the repo's own history:
 *
 * - `findTripOnBoard` retried its whole crawl 3x, blaming "a sibling test's
 *   parallel worker" shifting pagination — impossible, since every worker owns
 *   an isolated PGlite database. The real race was the navigation landing on
 *   the segment's linkless `loading.tsx` skeleton; the fix was waiting for the
 *   destination page's own link (PR #411).
 * - The offline-fallback assertion was "fixed" three times (#370, then twice
 *   more), each time by moving the same race one layer down, before the fix
 *   that asserted what the page shows rather than how long it took.
 *
 * Most of the banned shapes below encode a guess about timing. The passing form
 * is always the same: an auto-retrying `expect(locator)` assertion on content
 * that exists only after the awaited work completed — never a sleep, never a
 * loop, never "the network went quiet" (which streaming SSR keeps busy).
 *
 * Two rules here are not about timing at all but about **locators that report
 * nothing when they find nothing**, which is the same failure wearing different
 * clothes: a fix that looks right, passes review, and changes nothing.
 * `include-hidden` is one (the option is silently discarded by this suite's own
 * fixture wrapper) and `empty-all` is the other.
 *
 * Escape hatch: a line (or the line above it) carrying
 * `diveday:allow-e2e-hygiene <rule>: <why>` passes. The why must name the
 * mechanism that makes the wait deterministic, not restate that it is needed —
 * mirrors scripts/check-migrations.mjs's acknowledgement marker.
 */

export const ACKNOWLEDGEMENT = "diveday:allow-e2e-hygiene";

export const rules = [
  {
    id: "sleep",
    pattern: /\.waitForTimeout\s*\(/,
    message:
      "waitForTimeout is a sleep — it encodes a guess about how long the work takes. Wait for the destination's own content with an expect(locator) assertion instead.",
  },
  {
    id: "networkidle",
    pattern: /["'`]networkidle["'`]/,
    message:
      'waiting for "networkidle" is unreliable under streaming SSR (the connection stays busy) and Playwright itself deprecates it. Wait for the specific element the page renders when ready.',
  },
  {
    id: "retries",
    pattern: /\bretries\s*:/,
    message:
      "per-spec retries hide the flake this suite's retries: 0 policy exists to surface. Root-cause the race (see the debug skill) instead of retrying past it.",
  },
  {
    id: "include-hidden",
    pattern: /\bincludeHidden\s*:/,
    message:
      "`includeHidden` on a role query does nothing here: e2e/fixtures.ts wraps getByRole/getByText/getByLabel/getByPlaceholder in `.filter({ visible: true })`, so the option is discarded without a word and the query stays visible-only. That is worse than an error — a fix written with it looks right, passes review, and changes nothing (it cost one CI round on the schedule board's hidden cursor pager). Reach for a hidden element with `page.locator(...)`, which the fixture leaves alone, and give it an attribute to aim at.",
  },
  {
    id: "empty-all",
    pattern: /\.all\s*\(\s*\)/,
    /**
     * Satisfied by a count assertion on the locator in the few lines above —
     * `toHaveCount` is the only shape that *proves* the list is not empty, and
     * `not.toHaveCount(0)` reads as the floor it is. A window rather than an
     * identifier match: the locator is usually built over two or three lines,
     * and a scanner that tried to follow the variable would be guessing.
     */
    precededBy: /toHaveCount\s*\(/,
    window: 6,
    message:
      "an empty `.all()` is silent — it is a no-op loop, not an error, so a loop that finds nothing acts on nothing and reports nothing. Two of these were vacuous passes: `for (const chip of await chipLinks.all()) expect(height).toBeGreaterThanOrEqual(44)` proves exactly as much about zero chips as about ten. It compounds with `getByRole` matching an accessible name by **substring** — a spec waited on a level-3 heading as its arrival gate, the page it was *leaving* carried a row whose name contained it, and the two `.all()` loops after that snapshotted the wrong page, clicked nothing and returned clean. The failure surfaced eleven lines later as a missing element (issue #1111). Prove the list is not empty first — `await expect(locator).not.toHaveCount(0)` — or acknowledge the loop, naming what makes acting on nothing correct.",
  },
  {
    id: "retry-loop",
    pattern:
      /\b(?:for|while)\s*\(\s*(?:let|const|var)?\s*(?:attempts?|retry|retries|retryCount|tries|tryCount)\b/i,
    message:
      "a hand-rolled retry loop is the same hack as retries: — it converts a deterministic failure into an intermittent pass. Find what the loop is racing and wait for it directly.",
  },
];

/**
 * Pure scanner, exported for tests. Returns { rule, line, text } per hit;
 * a line acknowledged by the marker (on itself or the line above) is skipped.
 */
export function findHygieneViolations(source) {
  const lines = source.split("\n");
  const violations = [];
  lines.forEach((line, index) => {
    // Comment lines are prose about the pattern, not the pattern — the a11y
    // spec documents *why* its one networkidle wait is sound in comments that
    // would otherwise trip this scan.
    const trimmed = line.trim();
    if (trimmed.startsWith("//") || trimmed.startsWith("*") || trimmed.startsWith("/*")) return;
    const acknowledged =
      line.includes(ACKNOWLEDGEMENT) || (index > 0 && lines[index - 1].includes(ACKNOWLEDGEMENT));
    if (acknowledged) return;
    for (const rule of rules) {
      if (!rule.pattern.test(line)) continue;
      // A rule may name a proof that makes the shape sound — see `empty-all`.
      // The window looks back only: a proof written *after* the loop it is
      // meant to guard has already let the loop run on nothing.
      if (rule.precededBy) {
        const from = Math.max(0, index - rule.window);
        const before = lines.slice(from, index + 1).join("\n");
        if (rule.precededBy.test(before)) continue;
      }
      violations.push({ rule: rule.id, line: index + 1, text: line.trim() });
    }
  });
  return violations;
}

async function walk(relativeDirectory) {
  const absoluteDirectory = path.join(process.cwd(), relativeDirectory);
  let entries;
  try {
    entries = await readdir(absoluteDirectory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") return [];
    throw error;
  }
  const files = [];
  for (const entry of entries) {
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) files.push(...(await walk(relativePath)));
    else if (/\.tsx?$/.test(entry.name)) files.push(relativePath);
  }
  return files;
}

async function main() {
  const problems = [];
  for (const file of await walk("e2e")) {
    const contents = await readFile(path.join(process.cwd(), file), "utf8");
    for (const violation of findHygieneViolations(contents)) {
      const rule = rules.find((r) => r.id === violation.rule);
      problems.push(
        `${file}:${violation.line} [${violation.rule}]: ${violation.text}\n    ${rule.message}`,
      );
    }
  }

  if (problems.length > 0) {
    console.error(`E2E hygiene violations:\n${problems.map((p) => `- ${p}`).join("\n")}`);
    console.error(
      `A timing guess is never the fix — wait for what the page renders when the work is done (debug skill: "A flake is a bug"). If a line is genuinely deterministic, acknowledge it with \`${ACKNOWLEDGEMENT} <rule>: <why>\` naming the mechanism.`,
    );
    process.exit(1);
  }

  console.log("e2e-hygiene: no sleeps, networkidle waits, or retry shims in e2e/");
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
