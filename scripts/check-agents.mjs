// Keeps the agent layer in sync: skills on disk vs the skill index and AGENTS.md,
// skill/agent frontmatter, and task:context doc references. Many short-lived parallel
// sessions rely on these being accurate; drift here silently misroutes every one of them.
import { access, readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

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

async function listDirs(relative) {
  const entries = await readdir(path.join(ROOT, relative), { withFileTypes: true });
  return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
}

// 1. Every skill directory has a SKILL.md whose name matches and which describes its trigger.
const skillDirs = (await listDirs(".claude/skills")).sort();
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

// 2. The skill index and AGENTS.md reference exactly the skills that exist.
const skillIndex = await readFile(path.join(ROOT, ".claude/skills/README.md"), "utf8");
const agentsMd = await readFile(path.join(ROOT, "AGENTS.md"), "utf8");
const indexed = new Set([...skillIndex.matchAll(/^\| `([^`]+)` \|/gm)].map((m) => m[1]));
for (const dir of skillDirs) {
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
const routePathPattern = /`((?:src|scripts|docs|e2e|\.claude)\/[^`]*)`/g;
const routePathTokens = new Set(
  [...agentsMd.matchAll(routePathPattern)]
    .map((m) => m[1])
    .filter((token) => !token.includes("*") && !token.includes("<")),
);
for (const token of routePathTokens) {
  try {
    await access(path.join(ROOT, token));
  } catch {
    problems.push(`AGENTS.md: route-map path "${token}" does not exist`);
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

// 7. Every guard on disk actually runs. A scripts/check-*.mjs that check-repo.mjs
// doesn't spawn is a ratchet nobody turns — it would pass review as "checked"
// while never executing in `pnpm check`.
const checkRepoSource = await readFile(path.join(ROOT, "scripts/check-repo.mjs"), "utf8");
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
    file !== "check-all.mjs",
);
// The count AGENTS.md states for `pnpm check:repo` is the one number in that table a
// reader has no way to verify and every reason to trust. It is also the number that goes
// stale the instant somebody adds a guard, which is exactly when the table is least likely
// to be re-read.
const declaredCheckCount = Number(
  agentsMd.match(/^\| `pnpm check:repo` \| (\d+) static guards/m)?.[1],
);
const actualCheckCount = (checkRepoSource.match(/^\s+\["/gm) ?? []).length;
if (!declaredCheckCount) {
  problems.push(
    'AGENTS.md: the `pnpm check:repo` row no longer opens with "<n> static guards" — that phrasing is what keeps its count honest',
  );
} else if (declaredCheckCount !== actualCheckCount) {
  problems.push(
    `AGENTS.md: the \`pnpm check:repo\` row says ${declaredCheckCount} guards; scripts/check-repo.mjs spawns ${actualCheckCount}`,
  );
}

for (const file of checkScripts) {
  if (!checkRepoSource.includes(`"${file}"`))
    problems.push(
      `scripts/check-repo.mjs: ${file} exists but is never spawned — wire it into the checks table or it will never run`,
    );
}

if (problems.length > 0) {
  console.error(`Agent-layer drift:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  console.error(
    "Fix the stale reference (or add the missing index entry) in the same change — parallel sessions navigate by these files.",
  );
  process.exit(1);
}

console.log(
  `agents: ${skillDirs.length} skills, ${agentFiles.length} reviewer agents, ${Object.keys(areas).length} task-context areas, ${routePathTokens.size} AGENTS.md route-map paths in sync`,
);
