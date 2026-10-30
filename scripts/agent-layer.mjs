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

/** Upstream sentinels that a full sync must not restore over repository-local wording. */
export const VENDORED_SKILL_OVERRIDES = [
  { path: "**/SKILL.md", phrase: "/setup-matt-pocock-skills" },
  {
    path: "implement-spec/SKILL.md",
    phrase: "Use **implementer subagents** to implement each ticket",
  },
  { path: "implement/SKILL.md", phrase: "the full test suite once at the end" },
  { path: "research/SKILL.md", phrase: "Spin up a **background agent** to do the research" },
  { path: "tdd/SKILL.md", phrase: 'call the Skill tool with "codebase-design"' },
  { path: "wayfinder/SKILL.md", phrase: "Always call the Skill tool twice" },
  {
    path: "domain-modeling/ADR-FORMAT.md",
    phrase: "ADRs live in `docs/adr/` and use sequential numbering",
  },
  {
    path: "codebase-design/DESIGN-IT-TWICE.md",
    phrase: "Spawn 3+ sub-agents in parallel",
  },
];

/** Names returned upstream wording and reapply the repository's local override. */
export function vendoredSkillProblems(contentsByPath) {
  const problems = [];
  for (const { path, phrase } of VENDORED_SKILL_OVERRIDES) {
    const matches =
      path === "**/SKILL.md"
        ? Object.keys(contentsByPath).filter((file) => file.endsWith("/SKILL.md"))
        : [path];
    for (const file of matches)
      if (contentsByPath[file]?.includes(phrase))
        problems.push(
          `.agents/skills/${file}: upstream wording \`${phrase}\` returned; reapply the local override`,
        );
  }
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
