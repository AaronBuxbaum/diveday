// One provider-neutral policy. Push upstream is never evidence of a PR parent.
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export function resolveVerificationBase(git, { prBase, explicitBase, env = process.env } = {}) {
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const configured =
    explicitBase ??
    (branch && branch !== "HEAD" ? git(["config", "--get", `branch.${branch}.divedayBase`]) : null);
  const actual = prBase ?? env.GITHUB_BASE_REF;
  const candidates = [
    [actual, "pull-request"],
    [configured, "explicit-config"],
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
