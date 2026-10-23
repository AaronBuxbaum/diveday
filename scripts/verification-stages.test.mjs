import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { expect, it } from "vitest";
import { runBounded, SUBPROCESS_TIMEOUTS } from "./subprocess.mjs";
import {
  collectStages,
  runStageAsync,
  stageKey,
  verificationInputsStable,
} from "./verification-stages.mjs";

it("collects independent failures with bounded concurrency", async () => {
  let active = 0;
  let maximum = 0;
  const results = await collectStages(
    [1, 2, 3, 4],
    async (step) => {
      active++;
      maximum = Math.max(maximum, active);
      await new Promise((resolve) => setTimeout(resolve, 5));
      active--;
      return { step, status: step % 2 ? "failed" : "passed" };
    },
    2,
  );
  expect(maximum).toBe(2);
  expect(results.filter((row) => row.status === "failed")).toHaveLength(2);
});
it("invalidates receipts for tree, command, environment, tools or installation changes", () => {
  const input = {
    tree: "tree",
    step: { command: "lint" },
    env: { SECRET: "hidden" },
    tools: { node: "24" },
    dependencies: ["installed"],
  };
  const key = stageKey(input);
  expect(key).not.toContain("hidden");
  for (const field of ["tree", "step", "env", "tools", "dependencies"])
    expect(stageKey({ ...input, [field]: "changed" })).not.toBe(key);
  expect(stageKey({ ...input, dependencies: null })).toBeNull();
});

it("reports throwing collectors while finishing their peers", async () => {
  const results = await collectStages([{ name: "throw" }, { name: "peer" }], async (step) => {
    if (step.name === "throw") throw new Error("bad");
    return { name: step.name, status: "passed" };
  });
  expect(results.map((row) => row.status)).toEqual(["failed", "passed"]);
});

it("settles normal exit, missing executable and timed-out processes", async () => {
  expect(
    (await runStageAsync(process.execPath, ["-e", ""], { timeoutMs: 1000, stdio: "ignore" }))
      .status,
  ).toBe(0);
  expect(
    (await runStageAsync("/nonexistent/efficiency-tool", [], { timeoutMs: 1000, stdio: "ignore" }))
      .status,
  ).toBe(1);
  expect(
    (
      await runStageAsync(process.execPath, ["-e", "setInterval(()=>{},1000)"], {
        timeoutMs: 20,
        stdio: "ignore",
      })
    ).status,
  ).toBe(124);
});

it("refuses receipts after a concurrent HEAD/tree/working-file change", () => {
  const initial = { head: "a", tree: "t" };
  expect(verificationInputsStable({ ...initial, status: "" }, initial)).toBe(true);
  for (const changed of [
    { head: "b" },
    { tree: "u" },
    { status: " M src/a.ts" },
    { status: "?? new.ts" },
    { status: null },
  ])
    expect(verificationInputsStable({ ...initial, status: "", ...changed }, initial)).toBe(false);
});
/**
 * Whether `pid` still runs. A killed child whose parent has gone is re-parented to
 * PID 1, and a container whose PID 1 never reaps leaves it a zombie: dead, yet
 * still answering signal 0. Its state letter in /proc says which.
 */
function isAlive(pid) {
  try {
    process.kill(pid, 0);
  } catch {
    return false;
  }
  try {
    return readFileSync(`/proc/${pid}/stat`, "utf8").split(") ")[1]?.[0] !== "Z";
  } catch {
    return true;
  }
}

/**
 * SIGKILL is queued, not synchronous: the parent's `process.kill(-group)` returns, the parent
 * exits with 143, and on a loaded machine the child can still be tearing down when the test
 * looks. Poll the same liveness check until it clears or the bound passes.
 */
function diedWithin(pid, ms) {
  const sleeper = new Int32Array(new SharedArrayBuffer(4));
  const deadline = Date.now() + ms;
  while (isAlive(pid)) {
    if (Date.now() >= deadline) return false;
    Atomics.wait(sleeper, 0, 0, 20);
  }
  return true;
}

it("reaps owned detached stages with quote-bearing paths when their parent receives SIGTERM", () => {
  // These bytes must remain path data through both JSON-encoded JavaScript literals.
  // Unquoted interpolation would execute the exit canary instead of writing the PID.
  const dir = mkdtempSync(path.join(tmpdir(), 'stage-cancel-";process.exit(97);"-'));
  const pidFile = path.join(dir, "pid");
  const moduleUrl = pathToFileURL(path.resolve("scripts/verification-stages.mjs")).href;
  const childCode = `require('node:fs').writeFileSync(${JSON.stringify(pidFile)},String(process.pid));setInterval(()=>{},1000)`;
  const parentCode = `import {existsSync} from 'node:fs';import {runStageAsync} from ${JSON.stringify(moduleUrl)}; const timer=setInterval(()=>{if(existsSync(${JSON.stringify(pidFile)})){clearInterval(timer);process.kill(process.pid,'SIGTERM');}},10); await runStageAsync(process.execPath,['-e',${JSON.stringify(childCode)}],{timeoutMs:2000,stdio:'ignore'});`;
  let pid;
  try {
    const result = runBounded(process.execPath, ["--input-type=module", "-e", parentCode], {
      timeoutMs: SUBPROCESS_TIMEOUTS.nodeScript,
      stdio: "ignore",
    });
    expect(result.status).toBe(143);
    pid = Number(readFileSync(pidFile, "utf8"));
    expect(diedWithin(pid, 2000)).toBe(true);
  } finally {
    if (pid) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {}
    }
    rmSync(dir, { recursive: true, force: true });
  }
});
