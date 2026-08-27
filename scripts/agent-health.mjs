#!/usr/bin/env node
// A report on the environment the AI sessions work in — never a gate, never in `pnpm
// check`. The sibling of `pnpm gates`, which ages the human decisions; this one states the
// things about the agent layer that are easy to let drift because nothing goes red when
// they do.
//
// Four numbers, and each is here because it answers a question somebody would otherwise
// answer by guessing:
//
//   - **What every session pays before it reads any code.** AGENTS.md and CLAUDE.md in
//     full, plus every skill's and agent's `description:` line. `check:context-budget`
//     ratchets this; the report is where you see what it is made of and where the headroom
//     went.
//   - **How much of the front end is actually looked at.** The share of routes carrying a
//     visual capture and the share carrying an axe scan, both read out of
//     `scripts/route-coverage.json`. The a11y number is the one nothing else states: a new
//     staff page can ship with a screenshot and never be scanned, and the coverage file
//     already knows, because `a11y.spec.ts` is one of the specs it lists.
//   - **Whether the guards are themselves tested.** A `check-*.mjs` with no
//     `check-*.test.mjs` beside it is a rule whose judgement nobody has pinned; it can
//     start passing everything and nothing would say so.
//   - **What is wired into the session lifecycle.** The hooks, listed, because a hook is
//     invisible until it fires and a deleted one is invisible forever.

import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { measure } from "./check-context-budget.mjs";

const ROOT = process.cwd();
const TOKENS_PER_WORD = 1.35;

const readJson = async (file) => JSON.parse(await readFile(path.join(ROOT, file), "utf8"));
const percent = (part, whole) => (whole === 0 ? 0 : Math.round((part / whole) * 100));

function bar(share) {
  const filled = Math.round(share / 5);
  return `${"#".repeat(filled)}${".".repeat(20 - filled)}`;
}

console.log("Agent environment\n=================\n");

// ---------------------------------------------------------------- context
const measured = await measure(ROOT);
const { budgets } = await readJson("scripts/context-budget-baseline.json");
const total = Object.values(measured).reduce((sum, count) => sum + count, 0);

console.log("Always-loaded context (every session, main loop and subagents alike)");
for (const [file, count] of Object.entries(measured).sort((a, b) => b[1] - a[1])) {
  const budget = budgets[file];
  const headroom =
    budget === undefined
      ? ""
      : `  (budget ${budget}${count < budget ? `, ${budget - count} spare` : ", at budget"})`;
  console.log(`  ${String(count).padStart(6)} words  ${file}${headroom}`);
}
console.log(
  `  ${String(total).padStart(6)} words  TOTAL — roughly ${Math.round((total * TOKENS_PER_WORD) / 100) * 100} tokens before a session reads a line of code\n`,
);

// ------------------------------------------------------- front-end coverage
const coverage = await readJson("scripts/route-coverage.json");
const routes = Object.entries(coverage).filter(([route]) => !route.startsWith("//"));
const withVisual = routes.filter(([, entry]) => (entry.visual ?? []).length > 0);
const withA11y = routes.filter(([, entry]) => (entry.e2e ?? []).includes("a11y.spec.ts"));
const exempt = routes.filter(([, entry]) => entry.exempt);

console.log("Front-end coverage");
console.log(
  `  visual capture  ${bar(percent(withVisual.length, routes.length))}  ${withVisual.length}/${routes.length} routes (${percent(withVisual.length, routes.length)}%)`,
);
console.log(
  `  axe a11y scan   ${bar(percent(withA11y.length, routes.length))}  ${withA11y.length}/${routes.length} routes (${percent(withA11y.length, routes.length)}%)`,
);
console.log(`  written exemptions: ${exempt.length}\n`);

// ------------------------------------------------------------- the guards
const scriptFiles = await readdir(path.join(ROOT, "scripts"));
// The two orchestrators spawn the guards rather than judging anything themselves, and the
// e2e build probe needs a completed build to have an opinion at all.
const ORCHESTRATORS = new Set(["check-repo.mjs", "check-all.mjs", "check-e2e-build.mjs"]);
const guards = scriptFiles.filter(
  (file) =>
    file.startsWith("check-") &&
    file.endsWith(".mjs") &&
    !file.endsWith(".test.mjs") &&
    !ORCHESTRATORS.has(file),
);
const untested = guards.filter(
  (file) => !scriptFiles.includes(file.replace(/\.mjs$/, ".test.mjs")),
);

console.log("Repository guards");
console.log(
  `  ${guards.length} guard scripts, ${guards.length - untested.length} with tests beside them`,
);
if (untested.length > 0) {
  console.log("  no test pins their judgement:");
  for (const file of untested.sort()) console.log(`    scripts/${file}`);
}
console.log();

// -------------------------------------------------------------- the wiring
const settings = await readJson(".claude/settings.json");
const skills = (await readdir(path.join(ROOT, ".claude/skills"), { withFileTypes: true })).filter(
  (entry) => entry.isDirectory(),
);
const agents = (await readdir(path.join(ROOT, ".claude/agents"))).filter((f) => f.endsWith(".md"));

console.log("Session wiring");
console.log(`  ${skills.length} skills, ${agents.length} reviewer agents`);
for (const [event, entries] of Object.entries(settings.hooks ?? {})) {
  const commands = entries.flatMap((entry) =>
    (entry.hooks ?? []).map((hook) =>
      (hook.command ?? "").replace(/.*?scripts\//, "scripts/").replace(/"/g, ""),
    ),
  );
  console.log(`  ${event.padEnd(14)} ${commands.join(", ")}`);
}
console.log(
  "\nNothing here is a gate. `pnpm check:context-budget` is the only one of these numbers that can fail a build.",
);
