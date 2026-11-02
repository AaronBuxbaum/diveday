#!/usr/bin/env node
// Golden tasks for the agent setup (issue #3014): does a session still pick the right skill or
// reviewer after AGENTS.md, a rule, a skill description or a reviewer agent changes?
//
// `pnpm check:agents` proves the setup is wired up. This proves behaviour, the way Anthropic's
// "When to fold subagents into your main agent loop" asks for it: a small golden set
// (`evals/agents/tasks.json`), each task run more than once, and the report names which tasks
// flipped between runs rather than only a total.
//
//   node scripts/agent-evals.mjs --validate        offline: tasks reference real skills/agents
//   node scripts/agent-evals.mjs                   run every task twice headless, print the report
//   node scripts/agent-evals.mjs --task <id> --runs 3 --model <id> --out <file>
//
// A run costs real tokens (one headless `claude -p` per task per run, plan mode, a turn cap), so
// it is never wired into CI or `pnpm check` (the issue's own scope note). Each run executes in
// plan mode with editing tools denied, so a task cannot change the checkout.
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { runBounded } from "./subprocess.mjs";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const TASKS_FILE = path.join(ROOT, "evals/agents/tasks.json");
/** Per run. Deliberately not a SUBPROCESS_TIMEOUTS key: it is one headless model session. */
const RUN_TIMEOUT_MS = 600_000;
const MAX_TURNS = "20";

/** The tasks, or throws on a shape the runner cannot grade. */
export function loadTasks(file = TASKS_FILE) {
  const { tasks } = JSON.parse(readFileSync(file, "utf8"));
  if (!Array.isArray(tasks) || tasks.length === 0) throw new Error("agent-evals: no tasks");
  const ids = new Set();
  for (const task of tasks) {
    for (const key of ["id", "prompt", "source"]) {
      if (typeof task[key] !== "string" || !task[key]) {
        throw new Error(`agent-evals: task ${task.id ?? "?"} has no ${key}`);
      }
    }
    if (ids.has(task.id)) throw new Error(`agent-evals: duplicate task id ${task.id}`);
    ids.add(task.id);
    const expect = task.expect ?? {};
    if (!expect.skill && !expect.agent && expect.noSubagent !== true) {
      throw new Error(`agent-evals: task ${task.id} expects nothing`);
    }
  }
  return tasks;
}

/** Problems that make a task unrunnable now: an expected skill or agent that does not exist. */
export function validateTasks(tasks, { skills, agents }) {
  const problems = [];
  for (const task of tasks) {
    for (const name of task.expect.skill ?? []) {
      if (!skills.has(name)) problems.push(`${task.id}: no skill "${name}" in .agents/skills/`);
    }
    for (const name of task.expect.agent ?? []) {
      if (!agents.has(name))
        problems.push(`${task.id}: no reviewer agent "${name}" in .claude/agents/`);
    }
  }
  return problems;
}

function repoNames() {
  const skills = new Set(
    readdirSync(path.join(ROOT, ".agents/skills"), { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name),
  );
  const agents = new Set(
    readdirSync(path.join(ROOT, ".claude/agents"))
      .filter((file) => file.endsWith(".md"))
      .map((file) => file.slice(0, -3)),
  );
  return { skills, agents };
}

/**
 * What a `claude -p --output-format stream-json` transcript did: the skills it loaded and the
 * subagent types it spawned, read off `tool_use` blocks. Lines that are not JSON are skipped.
 */
export function observe(stream) {
  const skills = [];
  const agents = [];
  let text = "";
  for (const line of String(stream).split("\n")) {
    let event;
    try {
      event = JSON.parse(line);
    } catch {
      continue;
    }
    if (event?.type === "result" && typeof event.result === "string") text = event.result;
    if (event?.type !== "assistant") continue;
    for (const block of event.message?.content ?? []) {
      if (block?.type !== "tool_use") continue;
      if (block.name === "Skill" && block.input?.skill) {
        skills.push(String(block.input.skill).replace(/^.*:/, ""));
      }
      // A headless session mostly reads a skill's file rather than calling the Skill tool (seen
      // 2026-11-02: `sed -n 1,80p .agents/skills/schema-change/SKILL.md` as the second command),
      // so a read of `skills/<name>/SKILL.md` through any tool counts as loading it.
      const text = JSON.stringify(block.input ?? {});
      for (const match of text.matchAll(/skills\/([a-z0-9-]+)\/SKILL\.md/g)) {
        skills.push(match[1]);
      }
      if ((block.name === "Agent" || block.name === "Task") && block.input) {
        agents.push(String(block.input.subagent_type ?? "general-purpose"));
      }
    }
  }
  return { skills, agents, text };
}

/** Pass or fail with the reason; any listed skill or agent satisfies its list. */
export function grade(task, observed) {
  const { expect } = task;
  if (expect.skill && !expect.skill.some((name) => observed.skills.includes(name))) {
    return {
      pass: false,
      why: `loaded [${observed.skills.join(", ") || "no skill"}], wanted one of [${expect.skill.join(", ")}]`,
    };
  }
  if (
    expect.agent &&
    !expect.agent.some(
      (name) => observed.agents.includes(name) || String(observed.text ?? "").includes(name),
    )
  ) {
    return {
      pass: false,
      why: `spawned [${observed.agents.join(", ") || "no subagent"}], wanted one of [${expect.agent.join(", ")}]`,
    };
  }
  if (expect.noSubagent === true && observed.agents.length > 0) {
    return { pass: false, why: `spawned [${observed.agents.join(", ")}] for a one-file change` };
  }
  return { pass: true, why: "" };
}

/** `results`: task id -> array of `{ pass, why }`, one per run. */
export function report(tasks, results) {
  const lines = ["task | runs | verdict", "--- | --- | ---"];
  let flips = 0;
  let passed = 0;
  let total = 0;
  for (const task of tasks) {
    const runs = results[task.id] ?? [];
    if (runs.length === 0) continue;
    const marks = runs.map((run) => (run.pass ? "pass" : "FAIL")).join(" / ");
    const flipped = new Set(runs.map((run) => run.pass)).size > 1;
    if (flipped) flips += 1;
    passed += runs.filter((run) => run.pass).length;
    total += runs.length;
    const why = runs.find((run) => !run.pass)?.why;
    lines.push(
      `${task.id} | ${marks} | ${flipped ? "FLIPPED" : runs[0].pass ? "stable" : "stable fail"}${why ? ` (${why})` : ""}`,
    );
  }
  lines.push("", `${passed}/${total} runs passed; ${flips} task(s) flipped between runs.`);
  return lines.join("\n");
}

function runOnce(task, { model }) {
  const args = [
    "-p",
    task.prompt,
    "--output-format",
    "stream-json",
    "--verbose",
    "--permission-mode",
    "plan",
    "--disallowedTools",
    "Edit,Write,NotebookEdit",
    "--strict-mcp-config",
    "--max-turns",
    MAX_TURNS,
    ...(model ? ["--model", model] : []),
  ];
  const result = runBounded("claude", args, {
    cwd: ROOT,
    encoding: "utf8",
    maxBuffer: 256 * 1024 * 1024,
    stdio: ["ignore", "pipe", "pipe"],
    timeoutMs: RUN_TIMEOUT_MS,
  });
  if (result?.error || (!result?.stdout && result?.status !== 0)) {
    return {
      pass: false,
      why: `claude did not run: ${result?.error?.message ?? String(result?.stderr ?? "").slice(0, 200)}`,
    };
  }
  return grade(task, observe(result.stdout));
}

function main(argv) {
  const value = (name, fallback) => (argv.includes(name) ? argv[argv.indexOf(name) + 1] : fallback);
  const tasks = loadTasks();
  const problems = validateTasks(tasks, repoNames());
  if (problems.length > 0) {
    console.error(problems.join("\n"));
    process.exit(1);
  }
  if (argv.includes("--validate")) {
    console.log(`agent-evals: ${tasks.length} tasks, every expected skill and agent exists.`);
    return;
  }
  const only = value("--task");
  const runs = Number(value("--runs", "2"));
  const selected = tasks.filter((task) => !only || task.id === only);
  if (selected.length === 0) throw new Error(`agent-evals: no task "${only}"`);
  const results = {};
  for (const task of selected) {
    results[task.id] = [];
    for (let i = 0; i < runs; i += 1) {
      results[task.id].push(runOnce(task, { model: value("--model") }));
      console.error(
        `agent-evals: ${task.id} run ${i + 1}/${runs}: ${results[task.id].at(-1).pass ? "pass" : "FAIL"}`,
      );
    }
  }
  const text = report(selected, results);
  console.log(text);
  const out = value("--out");
  if (out) writeFileSync(out, `${text}\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (!existsSync(TASKS_FILE)) throw new Error("agent-evals: evals/agents/tasks.json is missing");
  try {
    main(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exit(1);
  }
}
