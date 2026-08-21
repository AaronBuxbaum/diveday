// A claim is one session saying "I am implementing this issue, on this branch,
// and I own these paths" — posted as a comment on the issue and marked with the
// `in-progress` label.
//
// It exists because the register that was supposed to answer "is anyone on
// this?" started too late. AGENTS.md already asks for a draft PR with owned
// paths, but a session that has begun and not yet pushed has no PR, no branch
// commit, and no visible footprint at all — on 2026-08-21 the only way to tell
// which issue a parallel window was implementing was to read the *name of its
// worktree directory*. A claim moves that declaration to the moment work
// starts, where the next session actually needs it.
//
// **The staleness half is the point, not a nicety.** A claim nobody can
// disprove is worse than no claim: a crashed session leaves a ticket marked
// taken forever, and "someone is on it" becomes indistinguishable from "someone
// was on it in August". That is the same failure this repo already knows by
// heart — the orphaned monitor, `TaskList` reporting "No tasks found" while a
// shell was alive, the nine-hour wait loop — and the lesson written down there
// is the one applied here: **the live state of the machine is the authority, a
// registry asserting what should be true is not.** So a claim carries a branch
// and a worktree precisely so it can be checked against `git`, and a claim that
// fails that check is reported dead no matter what the label says.
//
// ## Untrusted input
//
// A claim's fields are the body of a GitHub comment, so they are attacker-
// influencable the moment this repo takes an outside contribution. **No value
// parsed here is ever passed to a subprocess.** The two git reads below are
// constant argument arrays with no interpolation, and every question about a
// claim is then answered by looking its branch and worktree up in the *result*
// of those reads. That is not a sanitising layer that has to be right — there
// is no command for a crafted branch name like `--upload-pack=…` to reach, and
// no `fs` call for a `../../` worktree path to escape, because the claim's
// strings are only ever compared against strings git produced.

import path from "node:path";

import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export const IN_PROGRESS_LABEL = "in-progress";

/**
 * A ceiling on how many claims one report will process. Not a real limit —
 * anything approaching it means claims have stopped being cleared, which is
 * itself the finding.
 */
const MAX_CLAIMS = 200;

const FIELDS = /** @type {const} */ ({
  branch: "Branch",
  worktree: "Worktree",
  startedAt: "Started",
  owns: "Owns",
  alsoTouches: "Also touches",
});

const straight = (text) => text.replace(/[‘’]/g, "'").replace(/[“”]/g, '"');

/** `**Field:** value` on its own line, tolerant of the bold markers being absent. */
function field(body, label) {
  const pattern = new RegExp(`^\\s*\\*{0,2}${label}:\\*{0,2}\\s*(.+?)\\s*$`, "im");
  const value = pattern.exec(body)?.[1];
  if (!value) return null;
  // A field left as the template's own placeholder is not an answer.
  const bare = value.replace(/[`*]/g, "").trim();
  return bare && !/^(?:—|-|n\/a|tbd|todo)$/i.test(bare) ? bare : null;
}

/** A comma- or space-separated path list, backticks stripped, empties dropped. */
function pathList(value) {
  if (!value) return [];
  return value
    .split(/[,\s]+/)
    .map((entry) => entry.replace(/[`*]/g, "").trim())
    .filter(Boolean);
}

/**
 * One claim, parsed out of a comment body. Returns null for any comment that is
 * not a claim, and for a claim missing either fact the staleness check needs —
 * a claim that cannot be disproved is the thing this module exists to prevent,
 * so an unverifiable one is not a claim at all.
 */
export function parseClaim(body) {
  const text = straight(body ?? "");
  if (!/^\s*#{1,4}\s*Claim\s*$/im.test(text)) return null;

  const branch = field(text, FIELDS.branch);
  const worktree = field(text, FIELDS.worktree);
  const startedAt = field(text, FIELDS.startedAt);
  if (!branch || !worktree || !startedAt) return null;

  const started = Date.parse(startedAt);
  if (Number.isNaN(started)) return null;

  return {
    branch,
    worktree,
    startedAt: new Date(started),
    owns: pathList(field(text, FIELDS.owns)),
    alsoTouches: pathList(field(text, FIELDS.alsoTouches)),
  };
}

/**
 * The newest claim on an issue. Comments arrive oldest first from `gh`; a
 * session re-claiming an issue posts a fresh comment rather than editing the
 * old one, so the last one wins.
 */
export function latestClaimIn(comments) {
  let latest = null;
  for (const comment of comments ?? []) {
    const claim = parseClaim(comment.body ?? "");
    if (!claim) continue;
    const at = Date.parse(comment.createdAt ?? "");
    const postedAt = Number.isNaN(at) ? claim.startedAt : new Date(at);
    if (!latest || postedAt >= latest.postedAt) latest = { ...claim, postedAt };
  }
  return latest;
}

/**
 * Whether the session that made this claim still exists.
 *
 * `facts` is {@link readGitFacts}' output. A claim is **live** while either
 * half of it still holds — the worktree is on disk, or the branch has a commit
 * at or after the claim was made. Both gone means the session left nothing
 * behind and the claim is **stale**. `git` being unreadable is reported as
 * **unverifiable** rather than guessed either way: a report that invents a
 * verdict when it could not look is the registry problem again.
 *
 * Note the asymmetry, which is deliberate: a *live* worktree with no commits is
 * ordinary early work, but a *missing* worktree with no commits is a session
 * that produced nothing and is gone.
 */
export function classifyClaim(claim, facts, now) {
  const days = Math.max(0, Math.floor((now.getTime() - claim.startedAt.getTime()) / 86_400_000));
  if (!facts) return { state: "unverifiable", days, reason: "git unavailable" };

  const worktreeExists = facts.worktreePaths.has(normalizeWorktree(claim.worktree, facts.root));
  const lastCommit = facts.branchLastCommit.get(claim.branch) ?? null;
  const committedSince = lastCommit ? lastCommit.getTime() >= claim.startedAt.getTime() : false;

  if (worktreeExists || committedSince) {
    return {
      state: "live",
      days,
      reason: worktreeExists ? "worktree present" : "branch advanced",
      lastCommit,
    };
  }
  return {
    state: "stale",
    days,
    reason: facts.branchLastCommit.has(claim.branch)
      ? "worktree gone, branch has no commit since the claim"
      : "worktree gone, branch does not exist",
    lastCommit,
  };
}

/**
 * A claim's worktree as an absolute path, for comparison against git's own
 * list. Accepts either spelling a session might write — repo-relative
 * (`.claude/worktrees/foo`) or absolute — because worktrees legitimately live
 * outside the repo root as well as inside it.
 *
 * This resolves a string; it never touches the filesystem. A `..` in a claim
 * therefore reaches nothing: the worst it can produce is a path that matches no
 * entry in git's list, which reads as "worktree gone".
 */
export function normalizeWorktree(worktree, root) {
  const trimmed = worktree.replace(/\/+$/, "");
  return path.resolve(root, trimmed);
}

/**
 * The two facts every claim is checked against, both read with **constant**
 * argument arrays — no claim value reaches a subprocess. Returns null when git
 * cannot answer, which the caller reports rather than treating as "stale".
 */
export function readGitFacts(root) {
  const worktrees = git(root, ["worktree", "list", "--porcelain"]);
  const branches = git(root, [
    "for-each-ref",
    "--format=%(refname:short)%09%(committerdate:iso-strict)",
    "refs/heads/",
  ]);
  if (worktrees === null || branches === null) return null;

  const worktreePaths = new Set();
  for (const line of worktrees.split("\n")) {
    if (line.startsWith("worktree ")) worktreePaths.add(path.resolve(line.slice(9).trim()));
  }

  const branchLastCommit = new Map();
  for (const line of branches.split("\n")) {
    if (!line.trim()) continue;
    const [name, date] = line.split("\t");
    const at = Date.parse(date ?? "");
    if (name && !Number.isNaN(at)) branchLastCommit.set(name, new Date(at));
  }

  return { root, worktreePaths, branchLastCommit };
}

function git(root, args) {
  const result = runBounded("git", args, {
    cwd: root,
    encoding: "utf8",
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return result.status === 0 ? String(result.stdout ?? "") : null;
}

/**
 * Every issue carrying the label, paired with its newest claim and a verdict,
 * oldest claim first. An issue labelled in-progress with **no** parseable claim
 * comment is kept and reported — that is a claim nobody can check, which is
 * exactly the state this is here to surface.
 */
export function ageClaims(issues, facts, now) {
  return (issues ?? [])
    .slice(0, MAX_CLAIMS)
    .map((issue) => {
      const claim = latestClaimIn(issue.comments);
      return {
        id: `#${issue.number}`,
        title: issue.title ?? "",
        claim,
        verdict: claim
          ? classifyClaim(claim, facts, now)
          : {
              state: "unclaimed",
              days: null,
              reason: "labelled in-progress with no claim comment",
            },
      };
    })
    .sort((a, b) => (b.verdict.days ?? -1) - (a.verdict.days ?? -1) || a.id.localeCompare(b.id));
}

/**
 * Which claims overlap a set of paths — the question a session actually asks
 * before starting ("is anyone in the files I am about to edit?"). Prefix
 * matching on path segments, so `src/db` covers `src/db/trips.ts` and a
 * coincidental `src/dbx` is not a hit.
 */
export function claimsTouching(entries, paths) {
  const wanted = paths.map((entry) => entry.replace(/\/+$/, ""));
  return entries.filter(({ claim }) => {
    if (!claim) return false;
    const owned = [...claim.owns, ...claim.alsoTouches].map((entry) => entry.replace(/\/+$/, ""));
    return owned.some((entry) =>
      wanted.some(
        (target) =>
          entry === target || entry.startsWith(`${target}/`) || target.startsWith(`${entry}/`),
      ),
    );
  });
}
