import path from "node:path";
import process from "node:process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * One closing keyword per issue, because GitHub reads them that way.
 *
 * GitHub closes an issue on merge only where a closing keyword sits immediately
 * before its number. In a list — `Closes #1356, #1394, #1497, #1498` — the
 * keyword governs the first number and the rest are ordinary references, so
 * they stay open. Nothing reports this: the pull request merges green, the
 * first issue closes, and the others are left behind looking untouched.
 *
 * That is not a hypothetical. Merged on 2026-09-12, `Closes #1392, #1393,
 * #1395, #1506, #1511, #1632` (#1740) and `Closes #1356, #1394, #1497, #1498`
 * (#1743) closed #1392 and #1356 and left eight issues open over work that had
 * shipped — found days later by reading the tracker against the tree, and
 * closed by hand.
 *
 * ## Why the commit message is what this reads
 *
 * The keyword has to reach the default branch to fire at all, and on a stack it
 * reaches it through the commit message: a layer merges into the layer below,
 * and what finally lands on `main` is the commit, carrying whatever its message
 * says. Both incidents above are legible in `git log origin/main` today for
 * exactly that reason. So a commit message is both where the keyword must be
 * written and something this guard can read locally, on the branch, before the
 * pull request exists.
 *
 * A body-only keyword is a separate way to lose a closure and is out of reach
 * from here — see [docs/agents/issue-tracker.md](../docs/agents/issue-tracker.md),
 * which asks for the keyword in the commit message for this reason.
 *
 * ## What is guarded
 *
 * Commit messages on this branch — `git merge-base origin/main HEAD` to `HEAD`,
 * the same anchor `pnpm test:changed` and the destructive-migration guard use,
 * so on a stack it reads every layer's commits and not `main`'s history. A
 * branch with nothing of its own reads clean rather than failing.
 *
 * A finding is a closing keyword followed by its number and then one or more
 * further `#N` joined only by commas or `and`. The run stops at anything else,
 * which is what keeps prose out of it: `Closes #12. Related: #13, #14` is two
 * sentences and only the first is a closure, so #13 and #14 are never claimed.
 *
 * ## What is deliberately *not* guarded
 *
 * A bare `#N` that no keyword governs. Half of every pull request body in this
 * repository is cross-reference — "the same defect a reviewer flagged in #1687",
 * "filed as #1664" — and a rule that read those as intended closures would fail
 * honest branches constantly and be routed around within a week.
 */

const KEYWORDS = [
  "close",
  "closes",
  "closed",
  "fix",
  "fixes",
  "fixed",
  "resolve",
  "resolves",
  "resolved",
];

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

/** `Closes #12` — the keyword and the one number it actually governs. */
const KEYED = new RegExp(`\\b(${KEYWORDS.join("|")})\\s+#(\\d+)`, "gi");
/** `, #13` or ` and #14` — a continuation the keyword does *not* reach. */
const CONTINUATION = /^[ \t]*(?:,[ \t]*(?:and[ \t]+)?|and[ \t]+)#(\d+)/i;

/**
 * Every closing reference in `text` that GitHub will not act on.
 *
 * Returns one finding per keyword that governs a list, naming the number it
 * does close and the numbers it does not. Exported for the test beside this
 * file, which is where the shapes are pinned.
 */
export function findUnkeyedClosingReferences(text) {
  const findings = [];
  KEYED.lastIndex = 0;
  let match = KEYED.exec(text);
  while (match !== null) {
    const keyword = match[1];
    const closes = match[2];
    const unkeyed = [];
    let cursor = KEYED.lastIndex;
    let next = CONTINUATION.exec(text.slice(cursor));
    while (next !== null) {
      unkeyed.push(next[1]);
      cursor += next[0].length;
      next = CONTINUATION.exec(text.slice(cursor));
    }
    if (unkeyed.length > 0) {
      findings.push({ keyword, closes, unkeyed, text: text.slice(match.index, cursor) });
      // Resume past the list so a trailing number cannot be read twice.
      KEYED.lastIndex = cursor;
    }
    match = KEYED.exec(text);
  }
  return findings;
}

/** The form GitHub acts on, built from a finding so the fix can be pasted. */
export function correctedForm(finding) {
  const capitalised = finding.keyword[0].toUpperCase() + finding.keyword.slice(1).toLowerCase();
  return [finding.closes, ...finding.unkeyed].map((n) => `${capitalised} #${n}`).join("\n");
}

/**
 * One bounded `git` read. Mirrors `previous-release-migrations.mjs`'s shape so
 * the trunk fallback and the remedy message below can be the same ones.
 */
function defaultRun(args) {
  try {
    return {
      ok: true,
      out: readBounded("git", args, {
        cwd: ROOT,
        encoding: "utf8",
        maxBuffer: 16 * 1024 * 1024,
        timeoutMs: SUBPROCESS_TIMEOUTS.git,
      }),
    };
  } catch (error) {
    return { ok: false, out: String(error?.stderr ?? error?.message ?? error).trim() };
  }
}

/**
 * The commits this branch adds, as `{sha, subject, message}`.
 *
 * `origin/main` then `main`, the fallback order and the remedy
 * `previous-release-migrations.mjs` already uses, because a clone with neither
 * is the same clone in both cases. Failure is a **reason, not a skip**: exit 2
 * is deliberately a one-off for the one guard that makes a network call
 * ([docs/agents/repo-checks.md](../docs/agents/repo-checks.md)), and a checkout
 * this cannot read is one `pnpm test:changed` and the destructive-migration
 * guard cannot read either.
 *
 * On `main` itself the merge base is `HEAD`, so the range is empty and the
 * guard passes on nothing — which is right: `main`'s history is already merged
 * and its closing keywords have already had whatever effect they were going to.
 */
export function readBranchCommits(run = defaultRun) {
  const head = run(["rev-parse", "HEAD"]);
  if (!head.ok) return { ok: false, reason: "not a git repository (git rev-parse HEAD failed)" };

  let base = null;
  for (const trunk of ["origin/main", "main"]) {
    const resolved = run(["merge-base", trunk, "HEAD"]);
    if (!resolved.ok) continue;
    const sha = resolved.out.trim();
    if (sha) {
      base = sha;
      break;
    }
  }
  if (base === null) {
    return {
      ok: false,
      reason:
        "no trunk reachable — the clone has neither origin/main nor main, so the commits this branch adds cannot be identified. " +
        "Fetch history (CI: actions/checkout with fetch-depth: 0; locally: git fetch --unshallow).",
    };
  }

  // `%x00` and `%x1f`, so git writes the separators into its own output rather
  // than this process passing them as arguments: a NUL cannot travel in an argv
  // string, and an argument carrying one throws before git ever runs. NUL
  // between records because a commit message here is multi-line by convention
  // and a newline would split one message into several.
  const logged = run(["log", `${base}..HEAD`, "--format=%H%x1f%s%x1f%B%x00"]);
  if (!logged.ok) return { ok: false, reason: `git log ${base}..HEAD failed: ${logged.out}` };

  const commits = logged.out
    .split("\u0000")
    .map((record) => record.trim())
    .filter((record) => record.length > 0)
    .map((record) => {
      const [sha, subject, message] = record.split("\u001f");
      return { sha: sha.slice(0, 9), subject: subject ?? "", message: message ?? "" };
    });
  return { ok: true, commits };
}

async function main() {
  const read = readBranchCommits();
  if (!read.ok) {
    console.error(`closing-keywords: ${read.reason}`);
    process.exit(1);
  }
  const commits = read.commits;

  const violations = [];
  for (const commit of commits) {
    for (const finding of findUnkeyedClosingReferences(commit.message)) {
      violations.push({ commit, finding });
    }
  }

  if (violations.length > 0) {
    console.error(
      `Closing references GitHub will not act on:\n${violations
        .map(
          ({ commit, finding }) =>
            `- ${commit.sha} ${commit.subject}\n    ${finding.text.replace(/\s+/g, " ")}\n    closes #${finding.closes}; leaves ${finding.unkeyed.map((n) => `#${n}`).join(", ")} open`,
        )
        .join("\n")}`,
    );
    console.error(
      "\nGitHub honours a closing keyword only where it sits immediately before the number, so a comma-separated list closes its first issue and leaves the rest open — merged green, with nothing to notice. Repeat the keyword, one per issue:",
    );
    for (const { finding } of violations) {
      console.error(`\n${correctedForm(finding)}`);
    }
    console.error(
      "\nAmend the commit message (`git commit --amend`, or `git rebase -i` for an older one) — a pull request body alone does not reach the default branch on a stack, where a layer merges into the layer below. This is what left eight issues open over shipped work on 2026-09-12 (#1740, #1743).",
    );
    process.exit(1);
  }

  const keyed = commits.reduce(
    (total, commit) => total + (commit.message.match(KEYED)?.length ?? 0),
    0,
  );
  console.log(
    `closing-keywords: ${keyed} closing reference(s) across ${commits.length} commit(s) on this branch each carry their own keyword`,
  );
}

if (process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url) await main();
