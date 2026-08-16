#!/usr/bin/env node

import { spawn } from "node:child_process";
import { resolve } from "node:path";
import process from "node:process";

/**
 * Playwright's `webServer` owns this small supervisor, not `next start`
 * directly. The old direct command left the Next child behind when the runner
 * was interrupted between setup and teardown; its `next-server` descendant
 * then became an orphan and could be silently reused by local runs.
 *
 * The child is its own process group so one signal reaches `next start` and
 * every descendant it creates. The normal signal path is paired with the
 * synchronous `exit` cleanup for teardown failures; the latter is deliberately
 * a last-resort SIGKILL and never targets a process outside this group.
 */

const nextBin = resolve(process.cwd(), "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  detached: process.platform !== "win32",
});

let shuttingDown = false;
let forceKillTimer;

function signalChildGroup(signal) {
  if (!child.pid) return;
  const target = process.platform === "win32" ? child.pid : -child.pid;
  try {
    process.kill(target, signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  signalChildGroup(signal);
  forceKillTimer = setTimeout(() => signalChildGroup("SIGKILL"), 5_000);
  forceKillTimer.unref();
}

for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => shutdown(signal));
}

child.once("error", (error) => {
  console.error(`e2e server supervisor could not start Next: ${error}`);
  process.exitCode = 1;
});

child.once("exit", (code, signal) => {
  // The direct `next start` process may have exited while a descendant stayed
  // alive. Reap the whole group before marking the supervisor complete.
  signalChildGroup("SIGKILL");
  shuttingDown = true;
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exitCode = code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1);
});

process.once("exit", () => {
  // `exit` handlers are synchronous by design. If the parent is leaving before
  // the child emitted `exit`, do not leave a detached process group behind.
  if (!shuttingDown) signalChildGroup("SIGKILL");
});
