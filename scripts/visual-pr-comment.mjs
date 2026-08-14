#!/usr/bin/env node
// Posts (or updates) the sticky reg-suit summary comment on a pull request, and
// writes the same summary to the job summary. Runs in CI only, from the
// `visual-report` job.
//
// Why this exists when reg-suit already has a GitHub App: the app's payload is
// counts plus a report link and nothing else — verified in
// node_modules/reg-notify-github-plugin/lib/github-notifier-plugin.js, which
// POSTs `{failedItemsCount, newItemsCount, deletedItemsCount, passedItemsCount,
// reportUrl}` — so it can never name a surface, and it cannot distinguish "0
// changed because nothing moved" from "0 changed because no baseline resolved
// and nothing was compared" (ADR 20260729-reg-suit-visual-regression). It also
// posts nothing at all when `reg-suit run` itself throws, which is the loudest
// failure and the quietest signal.
//
// Three rules govern this script:
//   1. It never fails the build. Every path exits 0; the workflow step is
//      `continue-on-error` on top of that. A visual diff is warned about
//      loudly, never blocked (ADR 20260802-visual-diff-pr-comment).
//   2. It never needs `pnpm`. Bare `node` plus builtins only, so it still
//      reports when install or compare is what broke.
//   3. It never lies by omission. A truncated list says what it dropped, and a
//      run that compared nothing says so in those words.
import { appendFileSync } from "node:fs";
import process from "node:process";

import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import {
  COMMENT_MARKER,
  DEFAULT_BUCKET,
  fetchFromBucket,
  formatPrComment,
  summarizeReport,
} from "./visual-report-lib.mjs";

const API = process.env.GITHUB_API_URL || "https://api.github.com";

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--commit") args.commit = argv[++i];
    else if (arg === "--bucket") args.bucket = argv[++i];
    else if (arg === "--pr") args.pr = argv[++i];
    else if (arg === "--dry-run") args.dryRun = true;
    else {
      console.warn(`visual-pr-comment: ignoring unknown argument ${arg}`);
    }
  }
  return args;
}

// On a `pull_request` event GITHUB_SHA is the ephemeral merge commit, which is
// never a reg-suit key. The `visual-report` job checks out the branch by name,
// so HEAD is the same commit reg-suit keyed its upload under.
function resolveCommit(explicit) {
  if (explicit) return explicit;
  try {
    return readBounded("git", ["rev-parse", "HEAD"], {
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    }).trim();
  } catch {
    return process.env.GITHUB_SHA || "";
  }
}

async function api(path, { token, method = "GET", body }) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      accept: "application/vnd.github+json",
      authorization: `Bearer ${token}`,
      "x-github-api-version": "2022-11-28",
      ...(body ? { "content-type": "application/json" } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  if (!res.ok) {
    throw new Error(`GitHub API ${method} ${path} → HTTP ${res.status}: ${text.slice(0, 400)}`);
  }
  return text ? JSON.parse(text) : null;
}

async function findStickyComment(repo, pr, token) {
  // GitHub returns issue comments oldest-first, and ours is created on the
  // first push, so page 1 finds it on any realistic PR. Three pages of headroom
  // and then we give up and post a fresh one rather than paginate forever.
  for (let page = 1; page <= 3; page++) {
    const comments = await api(`/repos/${repo}/issues/${pr}/comments?per_page=100&page=${page}`, {
      token,
    });
    const match = comments.find((comment) => comment.body?.includes(COMMENT_MARKER));
    if (match) return match;
    if (comments.length < 100) return null;
  }
  return null;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const bucket = args.bucket || process.env.REG_SUIT_S3_BUCKET_NAME || DEFAULT_BUCKET;
  const commit = resolveCommit(args.commit);
  const repo = process.env.GITHUB_REPOSITORY;
  const pr = args.pr || process.env.PR_NUMBER;
  const token = process.env.GITHUB_TOKEN;

  if (!commit) {
    console.warn("visual-pr-comment: could not resolve a commit sha; nothing to report.");
    return;
  }

  let report = null;
  const fetched = await fetchFromBucket(bucket, `${commit}/out.json`, {}).catch((err) => ({
    ok: false,
    status: `fetch failed (${err.message})`,
  }));
  if (fetched.ok) {
    try {
      report = JSON.parse(fetched.body.toString("utf8"));
    } catch (err) {
      console.warn(`visual-pr-comment: out.json for ${commit} did not parse — ${err.message}`);
    }
  } else {
    console.warn(
      `visual-pr-comment: no out.json for ${commit} in bucket "${bucket}" (${fetched.status}).`,
    );
  }

  const summary = summarizeReport(report);
  const body = formatPrComment({ commit, bucket, summary });

  // The job summary is the one destination that works for every event,
  // including a push to main, where there is no PR to comment on.
  if (process.env.GITHUB_STEP_SUMMARY) {
    appendFileSync(process.env.GITHUB_STEP_SUMMARY, `${body}\n`);
  }
  console.log(body);

  if (args.dryRun) return;
  if (!pr || !repo || !token) {
    console.log(
      "visual-pr-comment: no pull request context (or no token) — summary printed above only. " +
        "This is the normal path for a push to main.",
    );
    return;
  }

  const existing = await findStickyComment(repo, pr, token);
  if (existing) {
    await api(`/repos/${repo}/issues/comments/${existing.id}`, {
      token,
      method: "PATCH",
      body: { body },
    });
    console.log(`visual-pr-comment: updated comment ${existing.id} on ${repo}#${pr}.`);
    return;
  }
  const created = await api(`/repos/${repo}/issues/${pr}/comments`, {
    token,
    method: "POST",
    body: { body },
  });
  console.log(`visual-pr-comment: posted comment ${created.id} on ${repo}#${pr}.`);
}

main().catch((err) => {
  // Deliberately exit 0. A visual diff must never fail the build, and neither
  // may this reporter's own infrastructure — a fork PR's read-only token, an S3
  // hiccup, a GitHub API blip. Say so loudly in the log and move on.
  console.warn(`visual-pr-comment: could not publish the summary — ${err.message}`);
  console.warn("visual-pr-comment: not failing the build; read the visual-report job log instead.");
});
