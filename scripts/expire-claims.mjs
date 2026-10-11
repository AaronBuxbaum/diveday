#!/usr/bin/env node
// Drops the `in-progress` label from a claim nobody is working, and says why on the issue.
//
// "A stale claim is a dead session: take the work" (AGENTS.md) was a rule nobody ran. On
// 2026-10-10, 18 issues were labelled in-progress, 13 of them claimed in September, and
// `pnpm gates` listed every one as "Claimed — in flight". A session reading that list takes the
// label at its word and picks other work, so a dead claim does not just sit there: it steers.
//
// A claim (docs/agents/issue-tracker.md's "Claiming an issue", parsed by `claims.mjs`) expires
// when either holds:
//
//   - its branch is not on origin and the claim is more than BRANCH_GRACE_DAYS old (a session
//     that has not pushed yet has no branch; a day is long enough to push one), or
//   - it is more than MAX_CLAIM_DAYS old and no open pull request has its branch as head.
//
// An issue labelled in-progress with no parseable claim is reported and left alone: there is no
// date to age and no branch to look up, and guessing is the failure claims.mjs refuses.
//
//   node scripts/expire-claims.mjs            report what would expire (needs gh)
//   node scripts/expire-claims.mjs --apply    remove the label and comment (follow-ups.yml, daily)
//
// Issue text is untrusted: a claim's branch is only ever compared against git's and gh's own
// output, never passed to a subprocess.

import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { IN_PROGRESS_LABEL, latestClaimIn } from "./claims.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const MAX_CLAIM_DAYS = 7;
export const BRANCH_GRACE_DAYS = 1;
const DAY = 86_400_000;

/**
 * The decision for one in-progress issue: `{ expire, reason, days }`. `branches` is the set of
 * branch names on origin, `openHeads` the head branches of open pull requests.
 */
export function claimVerdict(issue, { branches, openHeads, now }) {
  const claim = latestClaimIn(issue.comments);
  if (!claim) {
    return { expire: false, days: null, reason: "labelled in-progress with no claim comment" };
  }
  const days = Math.floor((now.getTime() - claim.postedAt.getTime()) / DAY);
  const onOrigin = branches.has(claim.branch);
  const hasPr = openHeads.has(claim.branch);
  if (!onOrigin && days > BRANCH_GRACE_DAYS) {
    return {
      expire: true,
      days,
      branch: claim.branch,
      reason: `branch \`${claim.branch}\` is not on origin`,
    };
  }
  if (days > MAX_CLAIM_DAYS && !hasPr) {
    return {
      expire: true,
      days,
      branch: claim.branch,
      reason: `claimed ${days} days ago and no open pull request has \`${claim.branch}\` as its head`,
    };
  }
  return {
    expire: false,
    days,
    branch: claim.branch,
    reason: hasPr ? "open pull request" : onOrigin ? "branch on origin" : "claimed within a day",
  };
}

export function expiryComment(verdict) {
  return [
    "## Claim expired",
    "",
    `The \`${IN_PROGRESS_LABEL}\` label is removed: ${verdict.reason}. A claim that nothing backs is a dead session, not a reservation (docs/agents/issue-tracker.md's "Claiming an issue").`,
    "",
    "Anyone may take this issue now. If the work is still going, post a fresh `## Claim` comment and re-add the label.",
    "",
    "_Posted by `scripts/expire-claims.mjs` from `.github/workflows/follow-ups.yml`._",
  ].join("\n");
}

function run(command, args) {
  const result = runBounded(command, args, {
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.gitFetch,
    stdio: ["ignore", "pipe", "pipe"],
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.slice(0, 3).join(" ")} failed: ${result.stderr ?? ""}`);
  }
  return String(result.stdout ?? "");
}

function main() {
  const apply = process.argv.includes("--apply");
  const issues = JSON.parse(
    run("gh", [
      "issue",
      "list",
      "--label",
      IN_PROGRESS_LABEL,
      "--state",
      "open",
      "--limit",
      "200",
      "--json",
      "number,title,comments",
    ]),
  );
  const branches = new Set(
    run("git", ["ls-remote", "--heads", "origin"])
      .split("\n")
      .map((line) => line.split("\t")[1]?.replace(/^refs\/heads\//, ""))
      .filter(Boolean),
  );
  const openHeads = new Set(
    JSON.parse(
      run("gh", ["pr", "list", "--state", "open", "--limit", "500", "--json", "headRefName"]),
    ).map((pr) => pr.headRefName),
  );
  const now = new Date();
  let expired = 0;
  for (const issue of issues) {
    const verdict = claimVerdict(issue, { branches, openHeads, now });
    const age = verdict.days === null ? "—" : `${verdict.days}d`;
    console.log(`#${issue.number} ${verdict.expire ? "EXPIRE" : "keep"} ${age} ${verdict.reason}`);
    if (!verdict.expire) continue;
    expired++;
    if (!apply) continue;
    run("gh", ["issue", "edit", String(issue.number), "--remove-label", IN_PROGRESS_LABEL]);
    run("gh", ["issue", "comment", String(issue.number), "--body", expiryComment(verdict)]);
  }
  console.log(
    `${expired} of ${issues.length} claims ${apply ? "expired" : "would expire (dry run; --apply to act)"}`,
  );
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (error) {
    // Exit 2 is SKIPPED, as in check-follow-ups.mjs: gh could not answer, so nothing was
    // decided. In follow-ups.yml, with the repository token, that fails the job.
    console.error(
      `expire-claims: SKIPPED — ${String(error?.message ?? error)
        .split("\n")[0]
        .slice(0, 300)}`,
    );
    process.exit(2);
  }
}
