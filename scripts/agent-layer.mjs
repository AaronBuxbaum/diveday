/**
 * The pure halves of `scripts/check-agents.mjs`, which runs top to bottom on import and so
 * cannot be tested by importing it, plus the one git question its doc-path rule asks.
 */
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

/**
 * Every place that states how many guards `pnpm check:repo` runs, and the phrase the number
 * sits in. A reader has no way to verify the number and every reason to trust it, and it goes
 * stale the instant somebody adds a guard — exactly when nobody re-reads the prose around it.
 */
export const GUARD_COUNT_SITES = [
  {
    file: "AGENTS.md",
    pattern: /^\| `pnpm check:repo` \| (\d+) static guards/m,
    phrase: "<n> static guards",
  },
  {
    file: "docs/agents/working-rules.md",
    pattern: /^\| `pnpm check:repo` \| (\d+) static guards/m,
    phrase: "<n> static guards",
  },
  {
    file: "docs/agents/repo-checks.md",
    pattern: /`scripts\/check-repo\.mjs` runs (\d+) guard scripts/,
    phrase: "`scripts/check-repo.mjs` runs <n> guard scripts",
  },
];

/** The rows of check-repo.mjs's checks table: one `["name", ...]` per line. */
export const spawnedGuardCount = (checkRepoSource) =>
  (checkRepoSource.match(/^\s+\["/gm) ?? []).length;

/** `texts` maps each site's file to its contents. */
export function guardCountProblems(texts, actual, sites = GUARD_COUNT_SITES) {
  const problems = [];
  for (const { file, pattern, phrase } of sites) {
    const declared = Number(texts[file]?.match(pattern)?.[1]);
    if (!declared)
      problems.push(
        `${file}: no longer states the \`pnpm check:repo\` count as "${phrase}" — that phrasing is what keeps it honest`,
      );
    else if (declared !== actual)
      problems.push(
        `${file}: says \`pnpm check:repo\` runs ${declared} guards; scripts/check-repo.mjs spawns ${actual}`,
      );
  }
  return problems;
}

/**
 * A skill vendored under `.agents/skills/` is linked into `.claude/skills/`, and
 * `skills-lock.json` names where it came from. Each side without the other is drift: a link
 * with no lock entry has no source to update from, and a lock entry with no link is a skill
 * no session can load.
 */
export function linkedSkillProblems(linked, locked) {
  const problems = [];
  for (const name of linked)
    if (!locked.includes(name))
      problems.push(
        `skills-lock.json: .claude/skills/${name} is linked in from .agents/skills/ but has no lock entry naming its source`,
      );
  for (const name of locked)
    if (!linked.includes(name))
      problems.push(
        `skills-lock.json: "${name}" is locked but .claude/skills/${name} is not a link to .agents/skills/${name}`,
      );
  return problems;
}

/**
 * Files a vendored skill carries from its upstream pack that are wrong here, each with the
 * local wording that replaced it. A sync from `skills-lock.json`'s source rewrites files under
 * `.agents/skills/` and brings the upstream wording back; this refusal is what notices.
 */
export const VENDORED_SKILL_OVERRIDES = [
  {
    path: "implement-spec/SKILL.md",
    phrase: "/setup-matt-pocock-skills",
    fix: "use the repository's canonical skill index and provider contract",
  },
  {
    path: "to-spec/SKILL.md",
    phrase: "/setup-matt-pocock-skills",
    fix: "use the repository's canonical skill index and provider contract",
  },
  {
    path: "to-tickets/SKILL.md",
    phrase: "/setup-matt-pocock-skills",
    fix: "use the repository's canonical skill index and provider contract",
  },
  {
    path: "triage/SKILL.md",
    phrase: "/setup-matt-pocock-skills",
    fix: "use the repository's canonical skill index and provider contract",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "/setup-matt-pocock-skills",
    fix: "use AGENTS.md and the provider contract to find this repository's tracker instructions",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "which points at `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`",
    fix: "use AGENTS.md and the provider contract to find the repository's tracker instructions",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "which points at `docs/agents/issue-tracker.md` and `docs/agents/triage-labels.md`",
    fix: "use AGENTS.md and the provider contract to find the repository's tracker instructions",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "background where possible for maximum concurrency",
    fix: "delegate only when the work is independent and merits parallel work, following the repository's worker limit",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "Use **implementer subagents** to implement each ticket",
    fix: "implement tickets in the integration session by default; delegate independent work when repository rules or the user's request call for it",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "calls the Skill tool with `tdd`",
    fix: "invoke the `tdd` skill",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "open a draft PR after the first merge in step 5",
    fix: "open a draft PR with the first commit, following repository worktree and stack rules",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "reviewer agents in `.claude/agents/`",
    fix: "reviewer roles required by AGENTS.md, using the active provider's supported review mechanism",
  },
  {
    path: "implement-spec/SKILL.md",
    phrase: "single **implementer subagent**",
    fix: "one assigned worker when review findings are independent and delegation is warranted",
  },
  {
    path: "research/SKILL.md",
    phrase: "Spin up a **background agent** to do the research",
    fix: "research in the current session by default; delegate when independent focus or parallel work merits it under repository rules",
  },
  {
    path: "research/SKILL.md",
    phrase: "reading is delegated to a background agent",
    fix: "a focused research question or independent research work merits delegation",
  },
  {
    path: "tdd/SKILL.md",
    phrase: 'call the Skill tool with "codebase-design"',
    fix: "consult the `codebase-design` skill",
  },
  {
    path: "tdd/SKILL.md",
    phrase: "reviewer agents in `.claude/agents/`",
    fix: "the review stage and reviewer roles required by repository rules",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: 'calls the Skill tool with "research"',
    fix: "use the `research` skill, delegating when the repository's rules warrant parallel work",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: 'by calling the Skill tool with "prototype"',
    fix: "use the `prototype` skill",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "Always call the Skill tool twice",
    fix: "consult the `grilling` and `domain-modeling` skills",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "Call the Skill tool twice",
    fix: "consult the `grilling` and `domain-modeling` skills",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "call the Skill tool for whichever skills",
    fix: "consult whichever skills",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "Fire the research subagents",
    fix: "delegate independent research tickets in parallel under the repository's worker limit",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "assigning it to the dev driving the map",
    fix: "using the repository's documented issue-claim procedure",
  },
  {
    path: "wayfinder/SKILL.md",
    phrase: "**Claim it**: assign it to yourself before any work",
    fix: "claim it through the tracker's documented procedure before any work",
  },
  {
    path: "domain-modeling/ADR-FORMAT.md",
    phrase: "ADRs live in `docs/adr/` and use sequential numbering",
    fix: "follow the linked repository ADR guide for the location and collision-resistant date-slug IDs",
  },
  {
    path: "codebase-design/DESIGN-IT-TWICE.md",
    phrase: "Spawn 3+ sub-agents in parallel",
    fix: "spawn at most three independent subagents in parallel under the repository's delegation rules",
  },
  {
    path: "codebase-design/DESIGN-IT-TWICE.md",
    phrase: "Agent 4 (if applicable)",
    fix: "fold adapter constraints into one of the three design briefs",
  },
];

/** Each override names a vendored file, upstream wording, and its repository-specific replacement. */
export function vendoredSkillProblems(contentsByPath) {
  const problems = [];
  for (const { path, phrase, fix } of VENDORED_SKILL_OVERRIDES)
    if (contentsByPath[path]?.includes(phrase))
      problems.push(`.agents/skills/${path}: names \`${phrase}\`; ${fix}`);
  return problems;
}

/**
 * A backticked token that names a repo path: it starts at one of the repo's top-level
 * directories. Globs and placeholders (`*`, `<feature>`, `…`, anything called `example`) are
 * prose, not a path; a bracketed Next.js segment such as `[shopSlug]` is literal, because the
 * directory is named exactly that.
 */
const DOC_PATH = /`((?:src|scripts|docs|e2e|config|infra|\.claude|\.agents|\.codex)\/[^`\s]*)`/g;

/**
 * A line that tells history or names a path by its absence rather than giving an instruction:
 * "(was …)", "until 2026-10-07", "used to", "was deleted", "exist nowhere". Its paths are left
 * alone, so a doc can still say where a file used to be (2026-10-13 re-review, item 18).
 */
const NOT_AN_INSTRUCTION =
  /\(was\b|\bwas `|\buntil 20\d\d-|\bused to\b|\bis gone\b|\bno longer\b|\b(?:was|were) (?:deleted|removed|renamed|moved)\b|\bbefore 20\d\d-|\bformerly\b|\bexists? nowhere\b/i;

/** A module specifier resolves with any of these, so `e2e/fixtures` names `e2e/fixtures.ts`. */
const MODULE_EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js"];

/**
 * The backticked repo paths in one Markdown file that resolve to nothing. `exists` answers for a
 * repo-relative path. The caller drops gitignored outputs (`.claude/.hook-log`), which a doc may
 * name though no checkout of main contains them.
 */
export function missingDocPaths(contents, exists) {
  const missing = [];
  const seen = new Set();
  for (const line of String(contents).split("\n")) {
    if (NOT_AN_INSTRUCTION.test(line)) continue;
    for (const match of line.matchAll(DOC_PATH)) {
      const token = match[1].replace(/[.,;:]+$/, "").replace(/:\d+(?:-\d+)?$/, "");
      if (seen.has(token) || /[*<…]|example/.test(token)) continue;
      seen.add(token);
      const bare = token.replace(/\/$/, "");
      if (!MODULE_EXTENSIONS.some((ext) => exists(`${bare}${ext}`))) missing.push(token);
    }
  }
  return missing;
}

/**
 * Which of `tokens` .gitignore covers, in one bounded `git check-ignore`. Asked by pattern
 * (`--no-index`), never by disk, so `e2e/screenshots/` counts in a fresh clone that has not made
 * it yet (CI) exactly as in a checkout that has. Exit 1 means none.
 */
export function gitignoredPaths(root, tokens) {
  const unique = [...new Set(tokens)];
  if (unique.length === 0) return new Set();
  const result = runBounded("git", ["check-ignore", "--no-index", "--stdin"], {
    cwd: root,
    encoding: "utf8",
    input: unique.join("\n"),
    timeoutMs: SUBPROCESS_TIMEOUTS.git,
  });
  return new Set(
    String(result.stdout ?? "")
      .split("\n")
      .filter(Boolean),
  );
}

/** Mirrors resolve to the canonical directory; copied bodies inevitably drift. */
export function providerSkillProblems(canonical, mirrors) {
  return canonical
    .filter((name) => mirrors[name] !== true)
    .map((name) => `.claude/skills/${name}: must resolve to .agents/skills/${name}`);
}
