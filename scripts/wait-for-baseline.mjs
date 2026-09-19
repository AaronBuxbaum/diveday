#!/usr/bin/env node
// Settles the reg-suit baseline on a snapshot that actually exists: walks past
// an expected key that has no snapshot to the nearest first-parent ancestor
// that does. Bounded, and never fatal.
//
// Why walk at all. `scripts/reg-suit-keys.mjs` names the expected key from the
// git graph (the parent commit, the fork point from the default branch), and
// the graph does not know which commits published. Two things leave a commit
// with no snapshot: a change that touched only docs, Markdown or `.claude/`
// skips the visual half of CI outright (the `changes` gate in ci.yml), and a
// push to main whose run was cancelled or lost a capture shard published
// nothing. In both cases the old behaviour was to compare against nothing and
// report every surface as *new* under `Changed: 0` — on 2026-09-01, five
// cancelled main runs in a row left the next one reporting 696 new, 0
// compared, and visual regression blind repo-wide. Comparing against an older
// ancestor is honest in a way that is stated: a diff may include main's own
// movement between the two commits, and the warning and the sticky comment say
// exactly which commit it is.
//
// **There used to be a wait here, and there is not any more.** A stacked
// layer's baseline was the layer below's head, and the only run that publishes
// that commit is the layer below's own — so this script polled S3 for up to
// twenty minutes hoping to see it, and `visual-report` carried a 35-minute
// timeout to contain the poll. A stacked layer is now keyed to the stack's
// fork point from the default branch, which `main`'s own run published long
// ago, so there is nothing left to wait for: every key this script is handed
// is either already in the bucket or never coming (ADR
// 20260919-stack-ci-cancels-superseded-layers). The walk below is what remains,
// and it was always the half that ran on every event.
//
// Two rules, in order of importance:
//   1. **It is never the reason a run goes red.** Every path exits 0. An S3
//      hiccup, a malformed report, a git call that throws: warn, and let the
//      compare run. `scripts/visual-pr-comment.mjs` already says "NOTHING WAS
//      COMPARED" in those words when nothing resolved.
//   2. **It always ends.** No poll, no deadline to get wrong, and a walk
//      bounded at `DEFAULT_MAX_ANCESTORS`. A wait whose only exit is a success
//      marker is the nine-hour loop AGENTS.md was written around, and the
//      surest way not to write one again is to have nothing to wait for.
//
// It needs no AWS credentials: the bucket serves these objects publicly, which
// is the same door `scripts/visual-report.mjs` and the sticky PR comment use.
import { appendFileSync } from "node:fs";
import process from "node:process";

import { gitReader } from "./reg-suit-keys.mjs";
import { DEFAULT_BUCKET } from "./visual-report-lib.mjs";

/** A reg-suit key is a full commit sha; anything else is a bug, not a baseline. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** S3 bucket naming rules, enough of them to keep a bad value out of a URL host. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** How long a single HTTP probe may take before it is abandoned. */
const REQUEST_TIMEOUT_MS = 20_000;
async function exists(bucket, key, { fetchImpl }) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const res = await fetchImpl(`https://${bucket}.s3.amazonaws.com/${key}`, {
      method: "HEAD",
      signal: controller.signal,
    });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timer);
  }
}

/** How far back the ancestor walk looks before giving up. Forty first-parent
 *  commits on main is a few days of merges; a gap wider than that is a
 *  pipeline outage, not a skipped docs commit, and deserves the loud path. */
export const DEFAULT_MAX_ANCESTORS = 40;

/**
 * The nearest commit at or before `key` (first-parent, so a walk along main
 * stays on main) whose snapshot is published, or null when none within
 * `maxAncestors` is.
 *
 * `skipped` counts the commits walked past: 0 means `key` itself is
 * published and nothing changes. The check is `out.json` alone rather than
 * the full-baseline check `waitForBaseline` does — that one guards a race
 * against an upload in flight, and an ancestor's upload finished long ago.
 *
 * @param git a reader taking an argv array and returning stdout, throwing on failure
 */
export async function nearestPublishedAncestor({
  bucket,
  key,
  git,
  maxAncestors = DEFAULT_MAX_ANCESTORS,
  fetchImpl = fetch,
}) {
  if (await exists(bucket, `${key}/out.json`, { fetchImpl })) return { key, skipped: 0 };
  let ancestors;
  try {
    ancestors = git(["rev-list", "--first-parent", `--max-count=${maxAncestors}`, `${key}^`])
      .split("\n")
      .map((line) => line.trim())
      .filter((sha) => COMMIT_SHA.test(sha));
  } catch {
    return null;
  }
  for (const [index, sha] of ancestors.entries()) {
    if (await exists(bucket, `${sha}/out.json`, { fetchImpl })) {
      return { key: sha, skipped: index + 1 };
    }
  }
  return null;
}

function appendEnv(file, lines) {
  if (!file) return;
  appendFileSync(file, `${lines.join("\n")}\n`);
}

async function main() {
  const bucket = process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const key = process.env.REG_EXPECTED_KEY;

  if (!key || !COMMIT_SHA.test(key)) {
    console.log(
      `wait-for-baseline: no expected key to settle (got "${key ?? ""}") — nothing to do, and the ` +
        "compare will report that it had no baseline.",
    );
    return;
  }
  if (!BUCKET_NAME.test(bucket)) {
    console.log(`wait-for-baseline: "${bucket}" is not a bucket name — nothing to settle.`);
    return;
  }

  const nearest = await nearestPublishedAncestor({ bucket, key, git: gitReader() });
  if (!nearest) {
    console.log(
      `::warning title=No baseline within reach::Neither ${key} nor any of its ${DEFAULT_MAX_ANCESTORS} ` +
        "first-parent ancestors has a published snapshot. This run's surfaces will be reported as " +
        "*new* rather than compared, and its Changed count means nothing. Re-run a green main run's " +
        "failed jobs to publish a baseline, then re-run this job.",
    );
    return;
  }
  if (nearest.skipped === 0) {
    console.log(`wait-for-baseline: the baseline for ${key} is published. Comparing.`);
    return;
  }
  const note =
    `Baseline is ${nearest.key.slice(0, 7)}, ${nearest.skipped} commit(s) before ${key.slice(0, 7)}, ` +
    "which published no snapshot (a docs-only change, or a main run that was cancelled or lost a " +
    "capture shard). Any surface main itself moved between the two commits is reported here as " +
    "this run's.";
  console.log(
    `::warning title=Baseline resolved to an ancestor::${note} Comparing against ${nearest.key}.`,
  );
  appendEnv(process.env.GITHUB_ENV, [
    `REG_EXPECTED_KEY=${nearest.key}`,
    `REG_BASELINE_NOTE=${note}`,
  ]);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Rule 1. Losing the race is the status quo; this script failing must never
    // be worse than not having it.
    console.log(
      `::warning title=Baseline resolution failed::wait-for-baseline could not check S3 or git (${error.message}). ` +
        "Comparing anyway; read the sticky visual summary to see whether a baseline resolved.",
    );
  });
}
