#!/usr/bin/env node
// Waits for the layer below a stacked pull request to publish the snapshot this
// layer's baseline is keyed to — bounded, and never fatal.
//
// Why a wait at all. reg-suit compares this commit against the snapshot
// published under its *base* commit, and for a stacked pull request that base
// commit is the layer below's head (ADR 20260821-stacked-pull-requests). Naming
// the key explicitly — which `scripts/reg-suit-keys.mjs` now does — cannot
// conjure the snapshot: the only run that publishes the layer below's head is
// the layer below's own, and GitHub's cascading rebase rewrites that head every
// time something merges underneath it. So on the run right after a rebase, both
// layers are in flight at once and the upper one asks S3 for a key the lower
// one has not uploaded yet. Losing that race reports every surface as *new*
// with `Changed: 0`, which reads like good news.
//
// Why `needs:` cannot do this: the layer below's `visual-report` job lives in a
// different workflow run on a different pull request. `needs:` is intra-run
// only. The gate has to be a poll, and a poll has to be told when to give up.
//
// Three rules, in order of importance:
//   1. **It is never the reason a run goes red.** Every path exits 0. A
//      deadline, an S3 hiccup, a malformed report: warn, and let the compare
//      run. Losing the race is the status quo, and `scripts/visual-pr-comment.mjs`
//      already says "NOTHING WAS COMPARED" in those words when it happens.
//   2. **It always ends.** A wait whose only exit is a success marker is the
//      nine-hour loop AGENTS.md was written around. The deadline below is the
//      exit; the success is the shortcut.
//   3. **Only a stacked layer waits.** The workflow decides that (base ref is
//      not the default branch) — applied to an ordinary pull request this would
//      block on a run that will never exist. This script trusts its caller and
//      states the assumption here.
//
// It needs no AWS credentials: the bucket serves these objects publicly, which
// is the same door `scripts/visual-report.mjs` and the sticky PR comment use.
import process from "node:process";

import { DEFAULT_BUCKET, fetchFromBucket } from "./visual-report-lib.mjs";

/** A reg-suit key is a full commit sha; anything else is a bug, not a wait. */
const COMMIT_SHA = /^[0-9a-f]{40}$/;
/** S3 bucket naming rules, enough of them to keep a bad value out of a URL host. */
const BUCKET_NAME = /^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/;

/** How long a single HTTP probe may take before it is abandoned and retried. */
const REQUEST_TIMEOUT_MS = 20_000;
/** Default ceiling on the whole wait. The layer below needs a build plus four
 *  capture shards, which is 15-25 minutes from the moment its run starts. */
export const DEFAULT_DEADLINE_MS = 20 * 60_000;
export const DEFAULT_INTERVAL_MS = 20_000;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * The paths reg-suit will try to download as the baseline: every surface the
 * layer below captured, under that run's own key. `actualItems` is the list it
 * published; the older payload shape without it is reconstructed the same way
 * `summarizeReport` does.
 */
export function baselineItems(report) {
  if (!report || typeof report !== "object") return [];
  const lists = Array.isArray(report.actualItems)
    ? [report.actualItems]
    : [report.passedItems, report.failedItems, report.newItems];
  const items = new Set();
  for (const list of lists) {
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      // A path out of somebody else's `out.json` is data, not a URL. Anything
      // that could climb out of this key's own prefix is dropped rather than
      // fetched, and a report made entirely of those counts as unreadable
      // below rather than as an empty baseline that is trivially complete.
      if (typeof item !== "string" || !item) continue;
      if (item.startsWith("/") || item.includes("://") || item.split("/").includes("..")) continue;
      items.add(item);
    }
  }
  return [...items];
}

/**
 * The directory the layer below published its captures under, straight out of
 * its own report — the same field `scripts/visual-report.mjs` reads to build a
 * download URL, rather than a second copy of the "actual" convention. Falls
 * back to reg-suit's default, and refuses anything that is not a plain name.
 */
export function baselineDir(report) {
  const dir = report?.actualDir;
  if (typeof dir !== "string" || !dir || !/^[\w.-]+$/.test(dir)) return "actual";
  return dir;
}

/** `a/b c.png` -> `a/b%20c.png`; the separators stay separators. */
function encodeItemPath(item) {
  return item.split("/").map(encodeURIComponent).join("/");
}

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

/**
 * Polls until the whole baseline is on S3, or the deadline passes.
 *
 * "The whole baseline" is deliberately stricter than "the report exists".
 * reg-suit uploads a run's files in sequential chunks and `out.json` sorts near
 * the end of them, so it is *almost* the last thing written — near enough that
 * a naive existence check usually works and occasionally hands the layer above
 * a baseline with a few images still in flight, which reads as a handful of
 * surfaces mysteriously "new". Reading the report and then confirming its own
 * items are all there costs one extra round of HEADs and removes the "almost".
 */
export async function waitForBaseline({
  bucket,
  key,
  deadlineMs = DEFAULT_DEADLINE_MS,
  intervalMs = DEFAULT_INTERVAL_MS,
  fetchImpl = fetch,
  now = () => Date.now(),
  wait = sleep,
  log = console.log,
}) {
  const started = now();
  let missing = null;
  let dir = "actual";

  for (let attempt = 1; ; attempt++) {
    const elapsed = Math.round((now() - started) / 1000);

    if (!missing) {
      const fetched = await fetchFromBucket(bucket, `${key}/out.json`, { fetchImpl }).catch(
        (error) => ({ ok: false, status: error.message }),
      );
      if (fetched.ok) {
        let report = null;
        try {
          report = JSON.parse(fetched.body.toString("utf8"));
        } catch (error) {
          return {
            ok: false,
            reason: `the layer below's out.json did not parse (${error.message})`,
          };
        }
        const items = baselineItems(report);
        if (items.length === 0) {
          return { ok: false, reason: "the layer below published a report with no surfaces in it" };
        }
        missing = items;
        dir = baselineDir(report);
        log(
          `wait-for-baseline: found the report for ${key} — checking its ${items.length} surface(s).`,
        );
      } else {
        log(
          `wait-for-baseline: no snapshot for ${key} yet (${elapsed}s elapsed, attempt ${attempt}).`,
        );
      }
    }

    if (missing) {
      const stillMissing = [];
      for (const item of missing) {
        if (!(await exists(bucket, `${key}/${dir}/${encodeItemPath(item)}`, { fetchImpl }))) {
          stillMissing.push(item);
        }
      }
      missing = stillMissing;
      if (missing.length === 0) return { ok: true, reason: `the baseline for ${key} is complete` };
      log(
        `wait-for-baseline: ${missing.length} baseline image(s) still uploading (${elapsed}s elapsed).`,
      );
    }

    if (now() - started + intervalMs >= deadlineMs) {
      return {
        ok: false,
        reason: `gave up after ${Math.round(deadlineMs / 60_000)} minutes`,
      };
    }
    await wait(intervalMs);
  }
}

async function main() {
  const bucket = process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const key = process.env.REG_EXPECTED_KEY;
  const deadlineMs = Number(process.env.BASELINE_WAIT_SECONDS || 0) * 1000 || DEFAULT_DEADLINE_MS;

  if (!key || !COMMIT_SHA.test(key)) {
    console.log(
      `wait-for-baseline: no expected key to wait for (got "${key ?? ""}") — nothing to do, and the ` +
        "compare will report that it had no baseline.",
    );
    return;
  }
  if (!BUCKET_NAME.test(bucket)) {
    console.log(`wait-for-baseline: "${bucket}" is not a bucket name — not waiting.`);
    return;
  }

  console.log(
    `wait-for-baseline: this pull request is stacked, so its baseline is the layer below's head ` +
      `(${key}). Waiting up to ${Math.round(deadlineMs / 60_000)} minutes for that layer's visual ` +
      "jobs to publish it.",
  );

  const result = await waitForBaseline({ bucket, key, deadlineMs });
  if (result.ok) {
    console.log(`wait-for-baseline: ${result.reason}. Comparing.`);
    return;
  }
  console.log(
    `::warning title=Stacked baseline not published::The layer below has not published the snapshot ` +
      `for ${key} — ${result.reason}. This layer's surfaces will be reported as *new* rather than ` +
      `compared, and its Changed count means nothing. Re-run this job once the layer below's ` +
      `visual jobs are green.`,
  );
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    // Rule 1. Losing the race is the status quo; this script failing must never
    // be worse than not having it.
    console.log(
      `::warning title=Baseline wait failed::wait-for-baseline could not check S3 (${error.message}). ` +
        "Comparing anyway; read the sticky visual summary to see whether a baseline resolved.",
    );
  });
}
