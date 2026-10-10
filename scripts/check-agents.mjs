// Keeps the agent layer in sync: skills on disk vs the skill index and AGENTS.md,
// skill/agent frontmatter, and task:context doc references. Many short-lived parallel
// sessions rely on these being accurate; drift here silently misroutes every one of them.
import { existsSync } from "node:fs";
import { access, lstat, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import {
  GUARD_COUNT_SITES,
  guardCountProblems,
  linkedSkillProblems,
  spawnedGuardCount,
  vendoredSkillProblems,
} from "./agent-layer.mjs";
import { listDirs } from "./check-context-budget.mjs";
import { findLaunchProblems } from "./mcp-launch-guard.mjs";
import { areas } from "./task-context-data.mjs";

const ROOT = process.cwd();
const problems = [];

function frontmatter(contents, file) {
  const match = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!match) {
    problems.push(`${file}: missing frontmatter block`);
    return {};
  }
  const fields = {};
  for (const line of match[1].split("\n")) {
    const separator = line.indexOf(":");
    if (separator > 0) fields[line.slice(0, separator).trim()] = line.slice(separator + 1).trim();
  }
  return fields;
}

// 1. Every skill directory has a SKILL.md whose name matches and which describes its trigger.
// A skill vendored under `.agents/skills/` is linked in, and `listDirs` follows the link, so a
// linked skill's frontmatter is checked like a local one's.
const skillDirs = await listDirs(ROOT, ".claude/skills");
const linkedSkills = new Set();
for (const dir of skillDirs) {
  if ((await lstat(path.join(ROOT, ".claude/skills", dir))).isSymbolicLink()) linkedSkills.add(dir);
}
for (const dir of skillDirs) {
  const file = `.claude/skills/${dir}/SKILL.md`;
  let contents;
  try {
    contents = await readFile(path.join(ROOT, file), "utf8");
  } catch {
    problems.push(`${file}: missing — every skill directory needs a SKILL.md`);
    continue;
  }
  const fields = frontmatter(contents, file);
  if (fields.name && fields.name !== dir)
    problems.push(`${file}: frontmatter name "${fields.name}" does not match directory "${dir}"`);
  if (!fields.description)
    problems.push(
      `${file}: frontmatter needs a description — it is how sessions decide to load the skill`,
    );
}

// 2. The skill index and AGENTS.md reference exactly the local skills; a linked skill is
// indexed by `skills-lock.json` instead, which names its upstream source.
const skillIndex = await readFile(path.join(ROOT, ".claude/skills/README.md"), "utf8");
const agentsMd = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
const indexed = new Set([...skillIndex.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));
for (const dir of skillDirs.filter((name) => !linkedSkills.has(name))) {
  if (!indexed.has(dir))
    problems.push(`.claude/skills/README.md: skill "${dir}" exists but is not in the index table`);
  if (!agentsMd.includes(dir))
    problems.push(`AGENTS.md: skill "${dir}" exists but is never mentioned`);
}
for (const name of indexed) {
  if (!skillDirs.includes(name))
    problems.push(
      `.claude/skills/README.md: index lists "${name}" but .claude/skills/${name}/ does not exist`,
    );
}
const locked = Object.keys(
  JSON.parse(await readFile(path.join(ROOT, "skills-lock.json"), "utf8")).skills ?? {},
);
problems.push(...linkedSkillProblems([...linkedSkills], locked));
const vendored = {};
for (const name of linkedSkills)
  vendored[name] = await readFile(
    path.join(ROOT, ".agents/skills", name, "SKILL.md"),
    "utf8",
  ).catch(() => "");
problems.push(...vendoredSkillProblems(vendored));

// 3. Reviewer agents: filename matches frontmatter, and the skill index mentions each.
const agentFiles = (await readdir(path.join(ROOT, ".claude/agents"))).filter((f) =>
  f.endsWith(".md"),
);
for (const file of agentFiles) {
  const agentName = file.replace(/\.md$/, "");
  const fields = frontmatter(
    await readFile(path.join(ROOT, ".claude/agents", file), "utf8"),
    `.claude/agents/${file}`,
  );
  if (fields.name && fields.name !== agentName)
    problems.push(
      `.claude/agents/${file}: frontmatter name "${fields.name}" does not match filename`,
    );
  if (!skillIndex.includes(agentName))
    problems.push(`.claude/skills/README.md: reviewer agent "${agentName}" is not mentioned`);
}

// 4. task:context areas point at files that exist — docs, code, and tests alike.
// `code`/`tests` used to be allowed to be "planned", which made a renamed-away
// module indistinguishable from an intended one: the nitrox area pointed
// sessions at a src/lib/nitrox.ts that never existed. An area entry is a claim
// about where the work lives; add the path when the file does exist.
for (const [areaName, area] of Object.entries(areas)) {
  for (const [kind, items] of [
    ["doc", area.docs],
    ["code", area.code],
    ["test", area.tests],
  ]) {
    for (const item of items ?? []) {
      try {
        await access(path.join(ROOT, item));
      } catch {
        problems.push(`task-context area "${areaName}": ${kind} path ${item} does not exist`);
      }
    }
  }
}

// 5. AGENTS.md's route map is the primary navigation surface every session reads first — a
// renamed or deleted path there silently misroutes all future sessions. Extract every
// backtick-wrapped token that looks like a repo path (starts with src/, scripts/, docs/, e2e/, or
// .claude/) and assert it exists on disk. Skip glob-ish or placeholder tokens (`**`, `<feature>`)
// — those are prose, not a literal path — but treat bracketed dynamic segments like `[shopSlug]`
// literally, since Next.js directories are named exactly that.
const routePathPattern = /`((?:src|scripts|docs|e2e|config|infra|\.claude)\/[^`]*)`/g;
const repoPathTokens = (markdown) =>
  new Set(
    [...markdown.matchAll(routePathPattern)]
      .map((m) => m[1])
      .filter((token) => !token.includes("*") && !token.includes("<")),
  );
const routePathTokens = repoPathTokens(agentsMd);
for (const token of routePathTokens) {
  try {
    await access(path.join(ROOT, token));
  } catch {
    problems.push(`AGENTS.md: route-map path "${token}" does not exist`);
  }
}

// 5b. The path-scoped rules carry the other half of the route map — the rows that only matter
// under one directory moved there so a session that never touches it never pays for them — and
// misroute exactly as badly when a path they name is renamed away. Every rules file needs
// frontmatter with a `paths:` list (a rule without one is loaded at launch, which the context
// budget counts, but is almost always a rule that meant to be scoped and forgot), and every
// backticked repo path in it must exist.
async function rulesFiles(relative = "") {
  const dir = path.join(ROOT, ".claude/rules", relative);
  let entries;
  try {
    entries = await readdir(dir, { withFileTypes: true });
  } catch {
    return [];
  }
  const found = [];
  for (const entry of entries) {
    const next = relative ? `${relative}/${entry.name}` : entry.name;
    if (entry.isDirectory()) found.push(...(await rulesFiles(next)));
    else if (entry.name.endsWith(".md")) found.push(next);
  }
  return found.sort();
}
const ruleFiles = await rulesFiles();
let rulePathCount = 0;
for (const file of ruleFiles) {
  const relative = `.claude/rules/${file}`;
  const contents = await readFile(path.join(ROOT, relative), "utf8");
  const block = contents.match(/^---\n([\s\S]*?)\n---/);
  if (!block) {
    problems.push(
      `${relative}: no frontmatter — a rule needs \`paths:\` so it loads only beside the files it governs; without one it is loaded by every session`,
    );
  } else if (!/^paths:/m.test(block[1])) {
    problems.push(
      `${relative}: frontmatter has no \`paths:\` list, so every session loads it in full — scope it, or move it into AGENTS.md where the budget can see it`,
    );
  } else {
    const globs = [...block[1].matchAll(/^\s*-\s*"?([^"\n]+?)"?\s*$/gm)].map((m) => m[1]);
    if (globs.length === 0) problems.push(`${relative}: \`paths:\` names no patterns`);
    for (const glob of globs) {
      // The literal directory prefix of each glob must exist: `src/db/**` needs `src/db`,
      // `scripts/aws-*.mjs` needs `scripts`.
      const beforeGlob = glob.split(/[*{[]/)[0];
      const literal = beforeGlob.includes("/")
        ? beforeGlob.slice(0, beforeGlob.lastIndexOf("/"))
        : beforeGlob;
      if (!literal) continue;
      try {
        await access(path.join(ROOT, literal));
      } catch {
        problems.push(`${relative}: \`paths:\` pattern "${glob}" — ${literal} does not exist`);
      }
    }
  }
  for (const token of repoPathTokens(contents)) {
    rulePathCount += 1;
    try {
      await access(path.join(ROOT, token));
    } catch {
      problems.push(`${relative}: path "${token}" does not exist`);
    }
  }
}

// 6. The permission allowlist references real things. A dead entry is worse
// than a missing one: it advertises a tool that doesn't exist (sessions go
// looking for scripts/screenshot.mjs) or silently grants nothing (a pnpm
// script that was renamed away prompts on every use instead of never).
const settings = JSON.parse(await readFile(path.join(ROOT, ".claude/settings.json"), "utf8"));
const pnpmBuiltins = new Set(["install", "add", "remove", "run", "exec", "dlx", "why", "outdated"]);
const packageScripts = new Set(
  Object.keys(JSON.parse(await readFile(path.join(ROOT, "package.json"), "utf8")).scripts ?? {}),
);
for (const entry of settings.permissions?.allow ?? []) {
  const bash = entry.match(/^Bash\((.+)\)$/)?.[1];
  if (!bash) continue;
  const scriptFile = bash.match(/^node (scripts\/[\w./-]+?)(?::\*)?$/)?.[1];
  if (scriptFile) {
    try {
      await access(path.join(ROOT, scriptFile));
    } catch {
      problems.push(`.claude/settings.json: allow entry "${entry}" — ${scriptFile} does not exist`);
    }
  }
  const pnpmTarget = bash.match(/^pnpm ([\w:.-]+?)(?::\*)?(?: .*)?$/)?.[1];
  if (pnpmTarget && !pnpmBuiltins.has(pnpmTarget) && !packageScripts.has(pnpmTarget)) {
    problems.push(
      `.claude/settings.json: allow entry "${entry}" — package.json has no "${pnpmTarget}" script`,
    );
  }
}

// 6b. Every hook command names a script that exists. A hook whose script is gone does not
// fail loudly: Claude Code reports a non-blocking "hook error" once and carries on, and the
// rule the hook enforced is silently back to being remembered. The same goes for a script
// that exists but is never wired — it looks like enforcement in the tree and enforces nothing.
const hookCommands = Object.entries(settings.hooks ?? {}).flatMap(([event, entries]) =>
  entries.flatMap((entry) =>
    (entry.hooks ?? []).map((hook) => ({ event, command: hook.command ?? "" })),
  ),
);
const wiredScripts = new Set();
for (const { event, command } of hookCommands) {
  const script = command.match(/scripts\/([\w.-]+\.mjs)/)?.[1];
  if (!script) {
    problems.push(`.claude/settings.json: ${event} hook "${command}" does not run a scripts/ file`);
    continue;
  }
  wiredScripts.add(script);
  if (!existsSync(path.join(ROOT, "scripts", script))) {
    problems.push(
      `.claude/settings.json: ${event} hook runs scripts/${script}, which does not exist`,
    );
  }
}
for (const script of [
  "guard-bash.mjs",
  "guard-read.mjs",
  "format-touched.mjs",
  "session-context.mjs",
  "explain-failure.mjs",
  "stray-processes.mjs",
  "unfinished-promises.mjs",
  "unpushed-work.mjs",
]) {
  if (!wiredScripts.has(script)) {
    problems.push(
      `scripts/${script} is a session hook but .claude/settings.json does not wire it — it enforces nothing until it runs`,
    );
  }
}

// 7. Every guard on disk actually runs. A scripts/check-*.mjs that check-repo.mjs
// doesn't spawn is a ratchet nobody turns — it would pass review as "checked"
// while never executing in `pnpm check`.
const checkRepoSource = await readFile(path.join(ROOT, "scripts/check-repo.mjs"), "utf8");
// A guard that reads the network instead of the tree runs on a schedule, never per branch:
// `check-follow-ups.mjs` reads the live tracker, and inside check:repo one malformed issue
// turned every open pull request red (#2036). It still has to run somewhere, so its
// workflow must name it.
const SCHEDULED_GUARDS = {
  "check-follow-ups.mjs": [".github/workflows/follow-ups.yml", "pnpm check:follow-ups"],
};
for (const [file, [workflow, command]] of Object.entries(SCHEDULED_GUARDS)) {
  const source = await readFile(path.join(ROOT, workflow), "utf8").catch(() => "");
  if (!source.includes(command))
    problems.push(`${workflow}: must run \`${command}\` — ${file} runs nowhere else`);
  if (checkRepoSource.includes(`"${file}"`))
    problems.push(
      `scripts/check-repo.mjs: ${file} reads the network and runs in ${workflow}, not per branch`,
    );
}
const checkScripts = (await readdir(path.join(ROOT, "scripts"))).filter(
  (file) =>
    file.startsWith("check-") &&
    file.endsWith(".mjs") &&
    !file.endsWith(".test.mjs") &&
    file !== "check-repo.mjs" &&
    // Opt-in / env-shaped checks that check-repo runs are listed in its own
    // `checks` table. Two standing exceptions: the e2e build probe, which needs
    // a completed `pnpm e2e:build` to have anything to inspect, and check-all,
    // which is the orchestrator one level *above* check-repo — it spawns this
    // file, so requiring this file to spawn it would be a cycle.
    file !== "check-e2e-build.mjs" &&
    file !== "check-all.mjs" &&
    !(file in SCHEDULED_GUARDS),
);
// Every place that states the `pnpm check:repo` count states the one check-repo.mjs spawns.
const guardCountTexts = {};
for (const { file } of GUARD_COUNT_SITES) {
  guardCountTexts[file] = await readFile(path.join(ROOT, file), "utf8").catch(() => "");
}
problems.push(...guardCountProblems(guardCountTexts, spawnedGuardCount(checkRepoSource)));

for (const file of checkScripts) {
  if (!checkRepoSource.includes(`"${file}"`))
    problems.push(
      `scripts/check-repo.mjs: ${file} exists but is never spawned — wire it into the checks table or it will never run`,
    );
}

// 8. Nothing agent-facing is launched through a package manager in a way that
// corrupts the stream a client reads. The rule and its reasoning live in
// scripts/mcp-launch-guard.mjs, which the test imports; this is the call that
// points it at the real tree.
const [mcpConfig, launchConfig] = await Promise.all(
  [".mcp.json", ".claude/launch.json"].map(async (file) => {
    try {
      return JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
    } catch {
      problems.push(`${file}: missing or not valid JSON`);
      return undefined;
    }
  }),
);
problems.push(
  ...findLaunchProblems({
    mcp: mcpConfig,
    launch: launchConfig,
    exists: (command) => existsSync(path.resolve(ROOT, command)),
  }),
);

if (problems.length > 0) {
  console.error(`Agent-layer drift:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  console.error(
    "Fix the stale reference (or add the missing index entry) in the same change — parallel sessions navigate by these files.",
  );
  process.exit(1);
}

console.log(
  `agents: ${skillDirs.length} skills (${linkedSkills.size} linked in from .agents/skills), ${agentFiles.length} reviewer agents, ${ruleFiles.length} path-scoped rules, ${hookCommands.length} hooks, ${Object.keys(areas).length} task-context areas, ${routePathTokens.size} AGENTS.md and ${rulePathCount} rules paths in sync`,
);
