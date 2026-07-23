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

// 4. task:context areas point at docs that exist (code/tests may be planned; docs may not).
for (const [areaName, area] of Object.entries(areas)) {
  for (const doc of area.docs) {
    try {
      await access(path.join(ROOT, doc));
    } catch {
      problems.push(`task-context area "${areaName}": doc ${doc} does not exist`);
    }
  }
}

if (problems.length > 0) {
  console.error(`Agent-layer drift:\n${problems.map((item) => `- ${item}`).join("\n")}`);
  console.error(
    "Fix the stale reference (or add the missing index entry) in the same change — parallel sessions navigate by these files.",
  );
  process.exit(1);
}

console.log(
  `agents: ${skillDirs.length} skills, ${agentFiles.length} reviewer agents, ${Object.keys(areas).length} task-context areas in sync`,
);
