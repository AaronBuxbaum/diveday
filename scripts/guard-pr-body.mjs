#!/usr/bin/env node
// A `PreToolUse` hook on the GitHub MCP's `create_pull_request` and `update_pull_request` that
// runs `scripts/check-pr-body.mjs` over the body before it reaches GitHub, and refuses a body
// CI's "Pull request body names its reviews" step would refuse.
//
// Four of the safeguard failures between 2026-10-09 and 2026-10-12 (#2369, #2371, #2375) were
// the body, not the code: a "Reviews:" paragraph where the template has a "## Reviews launched"
// heading, or the reviewer's answer on a sub-bullet under its name. Each cost a full CI run and
// an edit, and the check had been runnable locally the whole time.
//
// It checks only a body this checkout can answer for: the pull request's head is the branch
// checked out here (the changed files come from HEAD), and its base is known — from the call,
// or for an update without one, the layer below (`stackBase`). Anything else passes untouched.
// Fails open on everything: an unreadable payload, a missing script, a timeout.

import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

import { stackBase } from "./e2e-affected.mjs";
import { recordRefusal } from "./hook-log.mjs";
import { gitReader } from "./stack-map.mjs";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

const TOOLS = /^mcp__github__(?:create_pull_request|update_pull_request)$/;

/** The check-pr-body arguments for a tool call, or null when this checkout cannot answer. */
export function checkArgs(input, { branch, fallbackBase }) {
  if (!input || typeof input.body !== "string" || input.body.trim() === "") return null;
  if (input.head && input.head !== branch) return null;
  if (!branch || branch === "HEAD") return null;
  const base = input.base ? `origin/${input.base}` : fallbackBase;
  if (!base || !/^[\w./-]+$/.test(base)) return null;
  return { base, head: branch };
}

async function main() {
  let payload = "";
  for await (const chunk of process.stdin) payload += chunk;
  const parsed = JSON.parse(payload);
  if (!TOOLS.test(parsed.tool_name ?? "")) return;
  const cwd = parsed.cwd ?? process.cwd();
  const git = gitReader(cwd);
  const branch = git(["rev-parse", "--abbrev-ref", "HEAD"]);
  const args = checkArgs(parsed.tool_input, {
    branch,
    fallbackBase: parsed.tool_input?.base ? null : stackBase(git),
  });
  if (!args) return;

  const dir = mkdtempSync(path.join(tmpdir(), "pr-body-"));
  let refusal = null;
  try {
    const file = path.join(dir, "body.md");
    writeFileSync(file, parsed.tool_input.body);
    const result = runBounded(
      "node",
      [
        path.join(ROOT, "scripts/check-pr-body.mjs"),
        "--body-file",
        file,
        "--base",
        args.base,
        "--head",
        args.head,
      ],
      { cwd, encoding: "utf8", timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript },
    );
    if (result.status !== 1) return;
    refusal =
      `CI's "Pull request body names its reviews" step would refuse this body:\n${result.stderr.trim()}\n` +
      "Fix the body and send it again; the template is .github/pull_request_template.md.";
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  if (!refusal) return;
  recordRefusal("guard-pr-body", refusal, { session: parsed.session_id });
  console.error(`Refused by scripts/guard-pr-body.mjs: ${refusal}`);
  process.exit(2);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    await main();
  } catch {
    // Fail open, always and deliberately. See the module comment.
    process.exit(0);
  }
}
