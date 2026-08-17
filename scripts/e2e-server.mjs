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
 * Playwright already launches this command as the leader of a detached process
 * group and kills that group during teardown. The supervisor must stay in that
 * group: making the Next child detached here would put it beyond Playwright's
 * kill boundary and recreate the orphan leak this wrapper is meant to prevent.
 * The normal signal path is paired with synchronous `exit` cleanup for cases
 * where the supervisor itself is leaving before Next has emitted `exit`. A
 * parent-liveness watchdog covers the harder case where Playwright crashes or
 * is killed before it can run its webServer teardown.
 */

const nextBin = resolve(process.cwd(), "node_modules/next/dist/bin/next");
const child = spawn(process.execPath, [nextBin, "start", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  env: process.env,
  stdio: "inherit",
  // Playwright's webServer launcher owns the process group. Do not create a
  // nested detached group here; Playwright would then be unable to reap us.
  detached: false,
});

const ownerPid = process.ppid;
const ownerWatchdog = setInterval(() => {
  // An orphaned supervisor cannot rely on Playwright to clean up its process
  // group. This catches a crashed/killed launcher after one short interval.
  if (ownerPid !== 1 && process.ppid !== ownerPid) shutdown("SIGTERM");
}, 1_000);
ownerWatchdog.unref();

let shuttingDown = false;
let forceKillTimer;

function signalChild(signal) {
  if (!child.pid) return;
  try {
    child.kill(signal);
  } catch (error) {
    if (error?.code !== "ESRCH") throw error;
  }
}

function shutdown(signal) {
  if (shuttingDown) return;
  shuttingDown = true;
  signalChild(signal);
  forceKillTimer = setTimeout(() => signalChild("SIGKILL"), 5_000);
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
  // Playwright owns descendant cleanup at the process-group boundary. Kill the
  // direct child too in case it has not fully unwound when it emits `exit`.
  signalChild("SIGKILL");
  shuttingDown = true;
  clearInterval(ownerWatchdog);
  if (forceKillTimer) clearTimeout(forceKillTimer);
  process.exitCode = code ?? (signal ? 128 + (signal === "SIGINT" ? 2 : 15) : 1);
});

process.once("exit", () => {
  // `exit` handlers are synchronous by design. If the parent is leaving before
  // the child emitted `exit`, do not leave Next behind in Playwright's group.
  if (!shuttingDown) signalChild("SIGKILL");
});

// Playwright gives webServer commands piped stdio. EOF means the launcher is
// gone even when the runner did not reach its normal teardown path.
process.stdin.once("end", () => shutdown("SIGTERM"));
