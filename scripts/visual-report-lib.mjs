// Shared plumbing for the two consumers of a published reg-suit `out.json`:
// `pnpm visual:report` (scripts/visual-report.mjs — the local, agent-facing
// fetcher) and the CI PR comment (scripts/visual-pr-comment.mjs). Both need the
// same three things: the S3 fetch with its gzip quirk, one honest reading of
// what the report actually says, and one wording of it.
//
// Keep this file dependency-free and built only on node builtins: the CI step
// invokes it with a bare `node`, deliberately, so it still reports when
// `pnpm install` or `reg-suit run` is the thing that failed.
//
// See ADR 20260729-reg-suit-visual-regression and
// 20260802-visual-diff-pr-comment.
import { gunzipSync } from "node:zlib";

export const DEFAULT_BUCKET = "diveday-vrt";
export const GZIP_MAGIC = Buffer.from([0x1f, 0x8b]);

// Marks the CI comment so a later run can find and edit it instead of posting a
// second one. Never change this string: a comment posted under an older marker
// becomes unfindable, and the thread starts growing one comment per push.
export const COMMENT_MARKER = "<!-- diveday:visual-summary -->";

// How many item names one category may list before the comment truncates.
// AGENTS.md forbids a silent cap, so `formatPrComment` always states how many
// it dropped.
export const ITEM_LIST_LIMIT = 10;

export function objectUrl(bucket, key) {
  return `https://${bucket}.s3.amazonaws.com/${key}`;
}

export function hostedReportUrl(bucket, commit) {
  return objectUrl(bucket, `${commit}/index.html`);
}

// S3 serves these objects with `Content-Encoding: gzip`, but some fetch clients
// (Node's global fetch among them) already transparently decode that before
// returning the body, while others (plain `curl`, `https.get`) hand back the raw
// gzip bytes. Trust the magic number, not the header.
export async function fetchFromBucket(bucket, key, { fetchImpl = fetch } = {}) {
  const url = objectUrl(bucket, key);
  const res = await fetchImpl(url);
  if (!res.ok) {
    return { ok: false, status: res.status, url };
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const body = buf.subarray(0, 2).equals(GZIP_MAGIC) ? gunzipSync(buf) : buf;
  return { ok: true, body, url };
}

function names(value) {
  return Array.isArray(value) ? value.filter((item) => typeof item === "string") : [];
}

/**
 * Reads an `out.json` payload into the one thing a reviewer actually needs to
 * know: was anything compared, and did it move?
 *
 * The distinction matters because reg-suit's headline number lies in a specific
 * documented way. When baseline resolution fails — detached HEAD, a shallow
 * clone, a push whose parent snapshot was never published — every screenshot is
 * reported as *new* rather than diffed, so `failedItems.length` comes back a
 * reassuring **zero** while nothing was compared at all (ADR
 * 20260729-reg-suit-visual-regression). `expectedItems` is the tell: it is the
 * set of baseline images reg-suit actually downloaded, and it is empty exactly
 * when there was no baseline to compare against.
 *
 * Pass `null` for a report that could not be fetched at all.
 */
export function summarizeReport(report) {
  if (!report) {
    return {
      verdict: "no-report",
      changed: [],
      added: [],
      deleted: [],
      passedCount: 0,
      baselineCount: 0,
      capturedCount: 0,
      comparedCount: 0,
      changedCount: 0,
      warnings: [],
    };
  }

  const changed = names(report.failedItems);
  const added = names(report.newItems);
  const deleted = names(report.deletedItems);
  const passed = names(report.passedItems);
  const actual = names(report.actualItems);
  // `expectedItems` is what reg-suit publishes today. Reconstruct it from the
  // comparison outcome for any payload that omits it — every item that was
  // compared, in either direction, had a baseline image by definition.
  const baseline = report.expectedItems
    ? names(report.expectedItems)
    : [...passed, ...changed, ...deleted];

  const comparedCount = passed.length + changed.length + deleted.length;
  const changedCount = changed.length + added.length + deleted.length;
  const capturedCount = actual.length || passed.length + changed.length + added.length;

  let verdict;
  if (capturedCount === 0 && comparedCount === 0) verdict = "nothing-captured";
  else if (baseline.length === 0) verdict = "no-baseline";
  else if (changedCount > 0) verdict = "changes";
  else verdict = "clean";

  const warnings = [];
  if (verdict !== "no-baseline" && added.length > 0) {
    warnings.push(
      `${added.length} captured surface(s) had no baseline image and were **not compared** — ` +
        "expected for a newly added capture, but a large number here means the baseline resolved " +
        "only partially.",
    );
  }
  if (deleted.length > 0) {
    warnings.push(
      `${deleted.length} baseline surface(s) were **not captured** this run — expected if a ` +
        "capture was removed on purpose, otherwise a capture shard failed and its screenshots " +
        "never reached the merge.",
    );
  }

  return {
    verdict,
    changed,
    added,
    deleted,
    passedCount: passed.length,
    baselineCount: baseline.length,
    capturedCount,
    comparedCount,
    changedCount,
    warnings,
  };
}

/** The one-line counts summary `pnpm visual:report` has always printed. */
export function countsLine(summary) {
  return (
    `Changed: ${summary.changed.length} · New: ${summary.added.length} · ` +
    `Deleted: ${summary.deleted.length} · Passed: ${summary.passedCount}`
  );
}

/**
 * A plain-words headline for a summary. Every branch says explicitly whether
 * anything was compared, so "compared and found no differences" can never be
 * mistaken for "never compared anything".
 */
export function verdictHeadline(summary) {
  switch (summary.verdict) {
    case "no-report":
      return "Visual regression — no report was published";
    case "nothing-captured":
      return "Visual regression — no screenshots were captured";
    case "no-baseline":
      return "Visual regression — NOTHING WAS COMPARED";
    case "changes":
      // All three categories in the headline, deliberately. A surface that
      // appeared or vanished is as much a pixel change as one that moved, and
      // reg-suit's own "N differences" wording counts only the failed ones.
      return (
        `Visual regression — ${summary.changed.length} changed, ` +
        `${summary.added.length} new, ${summary.deleted.length} deleted`
      );
    default:
      return `Visual regression — no differences across ${summary.comparedCount} compared surface(s)`;
  }
}

function verdictBody(summary, { commit, bucket }) {
  switch (summary.verdict) {
    case "no-report":
      return [
        `reg-suit published no \`out.json\` for \`${commit}\`, so **nothing was compared and`,
        "nothing is known** about this commit's pixels. This is not a clean run.",
        "",
        "Usual causes: the compare step failed or never ran, the four `REG_SUIT_*` secrets are",
        "absent (every fork PR, by design — GitHub withholds secrets from fork workflows), or",
        `the bucket published to is not \`${bucket}\`. Read the \`visual-report\` job log.`,
      ].join("\n");
    case "nothing-captured":
      return [
        "reg-suit ran but saw **no screenshots at all** — neither captured nor baseline. The",
        "capture shards produced nothing, or their artifacts never reached the merge step.",
        "Nothing was compared; this is not a clean run.",
      ].join("\n");
    case "no-baseline":
      return [
        `reg-suit downloaded **0 baseline images**, so all ${summary.capturedCount} captured`,
        "surface(s) were reported as *new* rather than diffed. **No pixel on this commit was",
        'compared against anything.** Read this as "unknown", never as "no visual changes" — the',
        "zero in the Changed column below is an artifact of the missing baseline, not evidence.",
        "",
        "Documented causes (ADR 20260729-reg-suit-visual-regression): a commit whose baseline was",
        "never published to S3 — a push whose parent run failed its captures, a stacked layer whose",
        "layer below has not finished publishing (the `visual-report` job waits up to 20 minutes and",
        "then warns), or the first run against a new bucket. The job log will say",
        "`Failed to detect the previous snapshot key` when no key could be resolved at all.",
      ].join("\n");
    case "changes":
      return [
        `reg-suit compared **${summary.comparedCount}** surface(s) against the baseline for this`,
        `commit's parent and found **${summary.changedCount}** that differ. Every one needs an`,
        "explanation in this PR before merge — merging is what makes them the next baseline.",
      ].join("\n");
    default:
      return [
        `reg-suit compared **${summary.comparedCount}** surface(s) against the baseline for this`,
        "commit's parent and found no differences. A baseline did resolve, so this is a real",
        "comparison rather than an empty one.",
      ].join("\n");
  }
}

function itemSection(title, items, limit) {
  if (items.length === 0) return [];
  const sorted = [...items].sort();
  const shown = sorted.slice(0, limit);
  const lines = [`**${title}** (${items.length})`, ""];
  for (const name of shown) lines.push(`- \`${name}\``);
  if (sorted.length > shown.length) {
    lines.push(
      `- …and **${sorted.length - shown.length}** more not listed here — the full report linked below has all ${sorted.length}.`,
    );
  }
  lines.push("");
  return lines;
}

/**
 * Renders the sticky PR comment. Never throws, never blocks: the wording states
 * outright that this check is informational, because the enforcement of
 * "account for every pixel" is human review, not a red build
 * (ADR 20260802-visual-diff-pr-comment).
 */
export function formatPrComment({ commit, bucket, summary, limit = ITEM_LIST_LIMIT }) {
  const short = commit.slice(0, 7);
  const lines = [
    COMMENT_MARKER,
    `### ${verdictHeadline(summary)}`,
    "",
    verdictBody(summary, { commit, bucket }),
    "",
  ];

  if (summary.verdict !== "no-report") {
    lines.push(
      "| Changed | New (no baseline) | Deleted (not captured) | Passed | Baseline images |",
      "| ---: | ---: | ---: | ---: | ---: |",
      `| ${summary.changed.length} | ${summary.added.length} | ${summary.deleted.length} | ` +
        `${summary.passedCount} | ${summary.baselineCount} |`,
      "",
    );
  }

  for (const warning of summary.warnings) lines.push(`> [!WARNING]`, `> ${warning}`, "");

  lines.push(...itemSection("Changed", summary.changed, limit));
  lines.push(...itemSection("Deleted (in the baseline, not captured)", summary.deleted, limit));
  lines.push(...itemSection("New (captured, no baseline)", summary.added, limit));

  // Nothing was published for a `no-report` run, so both of these would 404 —
  // the job log is the only thing to read.
  if (summary.verdict !== "no-report") {
    lines.push(
      "**Look at the pixels**",
      "",
      `- Agents: \`pnpm visual:report --commit ${commit}\` — writes \`.reg-report/${short}…/REPORT.md\` plus the expected/actual/diff PNGs, readable without a browser.`,
      `- Humans: [hosted reg-suit report](${hostedReportUrl(bucket, commit)}) — a client-rendered SPA, so it needs a browser.`,
      "",
    );
  }

  lines.push(
    "This comment is informational and never fails the build. Accounting for every changed pixel",
    "is the reviewer's job (AGENTS.md), and merging an explained change is what makes it the next",
    "baseline.",
    "",
    `<sub>Commit \`${short}\` · posted by the \`visual-report\` CI job, updated in place on each push. ` +
      "The `reg` commit status and the reg-suit[bot] comment come from reg-suit's own GitHub App and " +
      "carry counts only; this comment adds the item names and checks that a baseline actually " +
      "resolved.</sub>",
  );

  return lines.join("\n");
}
