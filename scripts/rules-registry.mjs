// **The constitution's one index.** Every written rule a machine holds is one row here: its id,
// the sentence it holds, the sources that decided it (ADRs, human decisions, issues), and its
// holder, the file that goes red when the rule breaks.
//
// A holder takes one of two shapes. A **guard** is a `scripts/check-*.mjs` that `pnpm check:repo`
// spawns; `GUARDS` below is the list it spawns, so the index and the door are the same table. A
// **rule test** is a source-text test the Vitest `guards` project collects
// (`src/test/projects.ts`); `pnpm test:guards` runs them. No row is written by hand beyond the
// guard's line in `GUARDS`: the sentence is the first sentence of the holder's own header comment,
// and the sources are the ids that header cites, so a rule's reasoning lives once, beside its code.
//
// `node scripts/check-repo.mjs --list` prints the index. `scripts/check-agents.mjs` refuses a row
// whose holder is missing, has no header sentence, or cites an ADR or human decision that does
// not exist. No document states how many rules there are; the index is the count.

import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

/** Every guard `pnpm check:repo` spawns: id, then the script under `scripts/`. */
export const GUARDS = [
  ["env", "check-env.mjs"],
  ["architecture", "check-architecture.mjs"],
  ["tokens", "check-tokens.mjs"],
  ["tinted-ink", "check-tinted-ink.mjs"],
  ["type-ramp", "check-type-ramp.mjs"],
  ["page-length", "check-page-length.mjs"],
  ["form-controls", "check-form-controls.mjs"],
  ["voice", "check-voice.mjs"],
  ["logical-properties", "check-logical-properties.mjs"],
  ["db-concurrency", "check-db-concurrency.mjs"],
  ["image-sizes", "check-image-sizes.mjs"],
  ["adrs", "check-adrs.mjs"],
  ["human-decisions", "check-human-decisions.mjs"],
  ["design-canvases", "check-design-canvases.mjs"],
  ["docs", "check-doc-links.mjs"],
  ["glossary", "check-glossary.mjs"],
  ["agents", "check-agents.mjs"],
  ["context-budget", "check-context-budget.mjs"],
  ["e2e-fixtures", "check-e2e-fixtures.mjs"],
  ["e2e-hygiene", "check-e2e-hygiene.mjs"],
  ["critical-journeys", "check-critical-journeys.mjs"],
  ["route-coverage", "check-route-coverage.mjs"],
  ["loading-skeletons", "check-loading-skeletons.mjs"],
  ["staff-widths", "check-staff-widths.mjs"],
  ["uuid-segments", "check-uuid-segments.mjs"],
  ["notice-codes", "check-notice-codes.mjs"],
  ["scroll-preservation", "check-scroll-preservation.mjs"],
  ["exit-curves", "check-exit-curves.mjs"],
  ["shop-word", "check-shop-word.mjs"],
  ["seat-word", "check-seat-word.mjs"],
  ["capability-runbook", "check-capability-runbook.mjs"],
  ["rental-fit-caps", "check-rental-fit-caps.mjs"],
  ["icu-plurals", "check-icu-plurals.mjs"],
  ["live-trips", "check-live-trips.mjs"],
  ["checkout-purpose", "check-checkout-purpose.mjs"],
  ["live-people", "check-live-people.mjs"],
  ["seat-status", "check-seat-status.mjs"],
  ["person-door", "check-person-door.mjs"],
  ["event-scope", "check-event-scope.mjs"],
  ["roll-call-subject", "check-roll-call-subject.mjs"],
  ["slug-actions", "check-slug-actions.mjs"],
  ["env-reads", "check-env-reads.mjs"],
  ["harness-env", "check-harness-env.mjs"],
  ["action-pins", "check-action-pins.mjs"],
  ["trip-revision", "check-trip-revision.mjs"],
  ["time-id-order", "check-time-id-order.mjs"],
  ["departure-buffer", "check-departure-buffer.mjs"],
  ["text", "check-source-text.mjs"],
  ["infra-ascii", "check-infra-ascii.mjs"],
  ["locale", "check-locale.mjs"],
  ["copy", "check-copy.mjs"],
  ["bundle-reach", "check-bundle-reach.mjs"],
  ["domain-strings", "check-domain-strings.mjs"],
  ["migrations", "check-migrations.mjs"],
  ["migration-graph", "check-migration-graph.mjs"],
  ["open-graph", "check-open-graph.mjs"],
  ["critical-text", "check-critical-text.mjs"],
  ["ci-change-detection", "check-ci-change-detection.mjs"],
  ["node-version", "check-node-version.mjs"],
  ["runner-image", "check-runner-image.mjs"],
  ["closing-keywords", "check-closing-keywords.mjs"],
  ["sentry-imports", "check-sentry-imports.mjs"],
  ["tenant-gates", "check-tenant-gates.mjs"],
  ["instant", "check-instant.mjs"],
  ["shop-reads", "check-shop-reads.mjs"],
  ["redirect-slugs", "check-redirect-slugs.mjs"],
  ["capability-refusals", "check-capability-refusals.mjs"],
  ["intl-providers", "check-intl-providers.mjs"],
  ["assist-prompts", "check-assist-prompts.mjs"],
];

const COMMENT = /^\s*(?:\/\/+|\/\*+|\*+\/?)/;
const SKIPPED = /^\s*(?:$|#!|import\b|export\s.*\bfrom\b|\}\s*from\b|from\b|[\w$]+,$)/;

/**
 * The first sentence of a file's header comment: the first comment block above any code, skipping
 * a shebang and the imports. Markdown bold is kept; an empty string means the file has no header.
 */
export function headerSentence(source) {
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length && !COMMENT.test(lines[i])) {
    if (!SKIPPED.test(lines[i])) return "";
    i += 1;
  }
  const words = [];
  for (; i < lines.length && COMMENT.test(lines[i]); i += 1) {
    const text = lines[i]
      .replace(COMMENT, "")
      .replace(/\*\/\s*$/, "")
      .trim();
    if (!text && words.length) break;
    if (text) words.push(text);
  }
  const paragraph = words.join(" ");
  return paragraph.match(/^(.+?[.!?]\**)(?:\s|$)/)?.[1] ?? paragraph;
}

/** The ADR ids, human-decision ids and issue numbers a header cites. */
export function citedSources(header) {
  const adrs = [...header.matchAll(/\bADR[- ](\d{4}-[a-z0-9-]+|\d{8}-[a-z0-9-]+)/g)].map(
    (m) => `ADR ${m[1]}`,
  );
  const decisions = [...header.matchAll(/\b(H-\d{8}-[a-z0-9-]+)/g)].map((m) => m[1]);
  const issues = [...header.matchAll(/\bissue #?(\d+)/gi)].map((m) => `#${m[1]}`);
  return [...new Set([...adrs, ...decisions, ...issues])];
}

/** The leading comment block in full, the part `citedSources` reads. */
function headerBlock(source) {
  const lines = source.split("\n");
  let i = 0;
  while (i < lines.length && !COMMENT.test(lines[i]) && SKIPPED.test(lines[i])) i += 1;
  const block = [];
  for (; i < lines.length && COMMENT.test(lines[i]); i += 1) block.push(lines[i]);
  return block.join(" ");
}

/** The rule tests: every file the Vitest `guards` project collects. */
export async function ruleTestFiles(root) {
  // `src/test/projects.ts` is TypeScript that Node strips on import; the "add type: module" notice
  // it prints is noise in every guard's output.
  process.removeAllListeners("warning");
  const { partitionTestFiles } = await import(path.join(root, "src/test/projects.ts"));
  return partitionTestFiles(root).guards;
}

/** One row per rule: `{ id, kind, holder, sentence, sources }`. */
export async function rulesRegistry(root = process.cwd()) {
  const rows = [
    ...GUARDS.map(([id, script]) => ({ id, kind: "guard", holder: `scripts/${script}` })),
    ...(await ruleTestFiles(root)).map((holder) => ({
      id: path.basename(holder).replace(/\.test\.ts$/, ""),
      kind: "rule test",
      holder,
    })),
  ];
  return rows.map((row) => {
    const file = path.join(root, row.holder);
    const source = existsSync(file) ? readFileSync(file, "utf8") : null;
    return {
      ...row,
      exists: source !== null,
      sentence: source === null ? "" : headerSentence(source),
      sources: source === null ? [] : citedSources(headerBlock(source)),
    };
  });
}

/** Where a cited source lives, or null for one that names no file (an issue). */
function sourcePath(source) {
  if (source.startsWith("ADR ")) return `docs/architecture/decisions/${source.slice(4)}.md`;
  if (source.startsWith("H-")) return `docs/product/human-decisions/${source}.md`;
  return null;
}

/** Every row whose holder is missing, unexplained, or cites a decision that does not exist. */
export function registryProblems(rows, root = process.cwd()) {
  const problems = [];
  const ids = new Set();
  for (const row of rows) {
    if (ids.has(row.id)) problems.push(`rules registry: two rows are named "${row.id}"`);
    ids.add(row.id);
    if (!row.exists) {
      problems.push(`rules registry: ${row.id}'s holder ${row.holder} does not exist`);
      continue;
    }
    if (!row.sentence)
      problems.push(
        `rules registry: ${row.holder} has no header comment; open it with the sentence it holds`,
      );
    for (const source of row.sources) {
      const file = sourcePath(source);
      if (file && !existsSync(path.join(root, file)))
        problems.push(`rules registry: ${row.holder} cites ${source}, but ${file} does not exist`);
    }
  }
  return problems;
}

/** The index as a Markdown table, for `check-repo.mjs --list`. */
export function renderRegistry(rows) {
  const cell = (text) => text.replaceAll("|", "\\|");
  return [
    "| Rule | Kind | Holds | Sources | Holder |",
    "| --- | --- | --- | --- | --- |",
    ...rows.map(
      (row) =>
        `| ${row.id} | ${row.kind} | ${cell(row.sentence)} | ${row.sources.join(", ") || "none"} | \`${row.holder}\` |`,
    ),
  ].join("\n");
}
