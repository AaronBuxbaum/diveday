// One provider-neutral policy. Push upstream is never evidence of a PR parent.
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * The layer this branch is stacked on when no PR or config names one: the remote branch HEAD
 * contains that is furthest ahead of `origin/main`, excluding this branch's own remote and any
 * branch main already holds. A layer that merges the one below holds it through a second
 * parent, so "contains", not first-parent. Null when there is none.
 */
export function containedLayer(git) {
  const head = git(["rev-parse", "HEAD"]);
  if (!head) return null;
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const own = branch && branch !== "HEAD" ? `origin/${branch}` : null;
  const listed =
    git(["for-each-ref", "--format=%(refname:short)", "--merged", "HEAD", "refs/remotes/origin"]) ??
    "";
  let best = null;
  for (const ref of listed.split("\n").filter(Boolean)) {
    if (ref === own || ref === "origin/main" || ref === "origin/HEAD") continue;
    if (git(["rev-parse", ref]) === head) continue;
    const ahead = Number(git(["rev-list", "--count", `origin/main..${ref}`]));
    if (!Number.isFinite(ahead) || ahead === 0) continue;
    if (!best || ahead > best.ahead) best = { ref, ahead };
  }
  return best?.ref ?? null;
}

/**
 * The base a verification diffs against, in order: the open PR's base (or `GITHUB_BASE_REF`),
 * `--base` or `git config branch.<branch>.divedayBase <ref>`, the contained layer below
 * ({@link containedLayer}, for a stacked branch with no PR yet), then `origin/main`.
 */
export function resolveVerificationBase(git, { prBase, explicitBase, env = process.env } = {}) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const configured =
    explicitBase ??
    (branch && branch !== "HEAD" ? git(["config", "--get", `branch.${branch}.divedayBase`]) : null);
  const actual = prBase ?? env.GITHUB_BASE_REF;
  const candidates = [
    [actual, "pull-request"],
    [configured, "explicit-config"],
    [actual || configured ? null : containedLayer(git), "stack"],
    ["origin/main", "conservative-fallback"],
  ];
  for (const [name, source] of candidates) {
    if (!name || name.startsWith("-") || /[\s~^:]/.test(name)) continue;
    for (const ref of name.startsWith("origin/") ? [name] : [`origin/${name}`, name]) {
      if (git(["rev-parse", "--verify", "--quiet", ref])) {
        return {
          ref,
          source,
          warning:
            source === "conservative-fallback"
              ? "PR base unavailable; selecting against origin/main conservatively."
              : null,
        };
      }
    }
    // An authoritative but missing ref must not silently narrow against a different parent.
    if (source !== "conservative-fallback") break;
  }
  if (git(["rev-parse", "--verify", "--quiet", "origin/main"]))
    return {
      ref: "origin/main",
      source: "conservative-fallback",
      warning: "Requested base unavailable locally; selecting against origin/main.",
    };
  return {
    ref: null,
    source: "unavailable",
    warning: "Fetch the PR base or origin/main before selecting checks.",
  };
}

export function readPullRequestBase(git, { run = readBounded } = {}) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const remote = git(["remote", "get-url", "origin"]);
  const repo = remote?.match(/github\.com[:/]([^/]+)\/([^/]+?)(?:\.git)?$/);
  if (!repo || !branch || branch === "HEAD") return null;
  try {
    const pulls = JSON.parse(
      run(
        "gh",
        [
          "api",
          "--method",
          "GET",
          `repos/${repo[1]}/${repo[2]}/pulls`,
          "-f",
          "state=open",
          "-f",
          `head=${repo[1]}:${branch}`,
          "-f",
          "per_page=2",
        ],
        {
          encoding: "utf8",
          stdio: ["ignore", "pipe", "ignore"],
          timeoutMs: SUBPROCESS_TIMEOUTS.ghHookRead,
        },
      ),
    );
    return pulls.length === 1 ? (pulls[0].base?.ref ?? null) : null;
  } catch {
    return null;
  }
}
