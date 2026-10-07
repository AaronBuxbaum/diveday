/**
 * The pure halves of `scripts/check-agents.mjs`, which runs top to bottom on import and so
 * cannot be tested by importing it.
 */

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
