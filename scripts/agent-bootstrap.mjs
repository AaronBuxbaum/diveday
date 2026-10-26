import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { inspectState, readState } from "./agent-task-state.mjs";
import { readBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

export function capabilities(provider) {
  return {
    provider,
    canonicalSkills: ".agents/skills",
    rules: ".claude/rules",
    lifecycleHooks:
      provider === "claude"
        ? "configured in repository; host execution not verified"
        : "not configured by repository",
    scopedRules:
      provider === "claude"
        ? "host automatic loading must be verified"
        : "read matching rules explicitly",
    formatting: "pnpm exec biome check --write <owned-files>",
    verification: "pnpm lint && pnpm typecheck; CI is the gate",
    resume: "pnpm task:state",
    limits: "Does not observe global prompts, plugin tokens, host hooks, or cached model input.",
  };
}

export function bootstrap(
  root,
  provider,
  git = (args) =>
    readBounded("git", args, {
      cwd: root,
      encoding: "utf8",
      timeoutMs: SUBPROCESS_TIMEOUTS.git,
    }).trim(),
) {
  const head = git(["rev-parse", "HEAD"]);
  const state = readState(root);
  const dirtyPaths = git(["status", "--porcelain"]).split("\n").filter(Boolean);
  return {
    ...capabilities(provider),
    branch: git(["branch", "--show-current"]),
    head,
    dirty: {
      count: dirtyPaths.length,
      firstPaths: dirtyPaths.slice(0, 10),
      omitted: Math.max(0, dirtyPaths.length - 10),
    },
    node: process.versions.node,
    requiredNode: readFileSync(path.join(root, ".nvmrc"), "utf8").trim(),
    dependenciesPresent: existsSync(path.join(root, "node_modules")),
    taskState: state
      ? {
          ...inspectState(state, head),
          task: state.task,
          decisions: state.decisions,
          nextCommand: state.nextCommand,
          pending: state.pending,
          blockers: state.blockers,
        }
      : "missing; create before handing off nontrivial work",
    next: "pnpm task:context <area> or pnpm task:context --path <owned-file>",
  };
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const index = process.argv.indexOf("--provider");
  const provider = index < 0 ? "other" : process.argv[index + 1];
  if (!["claude", "codex", "other"].includes(provider))
    throw new Error("provider must be claude, codex, or other");
  console.log(JSON.stringify(bootstrap(process.cwd(), provider), null, 2));
}
